/**
 * Who plays (motion sheet 6.1; DESIGN_DIRECTION.md 6.3 and 7): one player at a time, and the one
 * video that plays by itself.
 *
 * - A player the visitor starts pauses every other player on the page, and while it plays no video
 *   starts by itself. A video holds playback until it pauses or ends (`holdPlayback` and
 *   `releasePlayback`); the audio player, which reports only its start (`claimPlayback`), holds it
 *   while any audio on the page plays; an embedded player, whose pause the page cannot hear, holds
 *   it until it leaves the page.
 * - A video may play by itself, muted, while at least `media.video.inView` of it is in view. Of the
 *   videos that may, the one most in view plays and the others wait; it pauses when it drops below
 *   (`joinAutoplay`). Whether a video may (motion allowed, no Save-Data, the visitor has not taken
 *   it over) is the player's own call.
 * - The lightbox is a layer over the page (`openLayer`): the videos and embedded players under it
 *   pause, and only its own may play by themselves until it closes. The audio player has nothing
 *   to see and so no layer: it plays on under the lightbox, and its hold with it (nothing there
 *   plays by itself while it plays).
 *
 * Plain module state shared by every player on the page. Nothing here renders, and nothing runs
 * on the server: players register from their effects.
 */
import { media } from '@/lib/motion';

/** The layer of a player inside the lightbox; the page's players are on layer 0. */
export const LIGHTBOX_LAYER = 1;

interface Player {
  pause: () => void;
  /** The layer it shows on (0 is the page), or null for a player with nothing to see (audio). */
  layer: number | null;
}

interface Hold {
  id: string;
  /** What ends the hold: the player's own release, its leaving the page, or the end of all audio. */
  until: 'pause' | 'leave' | 'audio';
}

interface Candidate {
  share: number;
  layer: number;
  play: () => void;
  stop: () => void;
}

const players = new Map<string, Player>();
/** In the order they joined, which breaks a tie: the earlier one sits higher on the page. */
const candidates = new Map<string, Candidate>();
let hold: Hold | null = null;
/** The video playing by itself, if any. */
let current: string | null = null;
/** How many layers are open over the page: the lightbox makes it 1. */
let depth = 0;
let hearingAudio = false;

/**
 * Registers a player's pause function, on the layer it shows on (0 is the page; a video or an
 * embedded player always names its layer). A player with nothing to see (the audio player) names
 * none: no layer covers it, so a lightbox never pauses it. Returns the function that removes it.
 */
export function registerPlayer(id: string, pause: () => void, layer?: number): () => void {
  const player: Player = { pause, layer: layer ?? null };
  players.set(id, player);
  return () => {
    if (players.get(id) === player) players.delete(id);
    if (hold?.id === id) setHold(null);
  };
}

/**
 * The audio player started: every other player pauses, and no video starts by itself while any
 * audio plays (the audio player reports its start, not its pause).
 */
export function claimPlayback(id: string): void {
  pauseOthers(id);
  setHold({ id, until: 'audio' });
}

/**
 * The visitor started a video (`until: 'pause'`, released with `releasePlayback`) or loaded an
 * embedded player (`until: 'leave'`): every other player pauses, and no video starts by itself
 * until the hold ends.
 */
export function holdPlayback(id: string, until: 'pause' | 'leave'): void {
  pauseOthers(id);
  setHold({ id, until });
}

/** The video that held playback paused or ended. */
export function releasePlayback(id: string): void {
  if (hold?.id === id && hold.until === 'pause') setHold(null);
}

export interface AutoplayHandle {
  /** The share of the video in view, from 0 to 1 (`viewShare`); 0 while the tab is hidden. */
  setShare: (share: number) => void;
  /** The video no longer plays by itself. It is not paused here: the visitor may have taken it over. */
  leave: () => void;
}

/**
 * A video that may play by itself joins the rule: `play` starts it muted, `stop` pauses what it
 * started. Both are called only from here.
 */
export function joinAutoplay(
  id: string,
  candidate: { layer: number; play: () => void; stop: () => void },
): AutoplayHandle {
  const entry: Candidate = { share: 0, ...candidate };
  candidates.set(id, entry);
  return {
    setShare: (share) => {
      if (candidates.get(id) !== entry || entry.share === share) return;
      entry.share = share;
      settle();
    },
    leave: () => {
      if (candidates.get(id) !== entry) return;
      candidates.delete(id);
      if (current === id) current = null;
      settle();
    },
  };
}

/**
 * Opens a layer over the page (the lightbox): every player it covers pauses, and only players on it
 * may play by themselves. The audio player, which no layer covers, plays on, and its hold stays.
 * Returns the function that closes it.
 */
export function openLayer(): () => void {
  depth += 1;
  const top = depth;
  players.forEach((player) => {
    if (coveredBy(player, top)) player.pause();
  });
  // A covered player's hold ends with its pause.
  const holder = hold ? players.get(hold.id) : undefined;
  if (hold && (!holder || coveredBy(holder, top))) setHold(null);
  else settle();
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    depth = Math.max(0, depth - 1);
    settle();
  };
}

/**
 * Tells a video's `play` and `pause` events that the page caused from the visitor's own (a phone's
 * own player, the system's media keys). Media events arrive after the calls that queued them, so
 * by then the element may have moved on (a quick pause, play, pause queues three events and ends
 * paused); the ledger counts the page's calls as they are made and takes one per event, in order.
 * Count only calls that queue an event: a start on a paused element, a pause on a playing one.
 */
export class PlaybackLedger {
  private autoStarts = 0;
  private askedPauses = 0;

  /** Just before the autoplay rule's `play()` on a paused video. */
  autoStart(): void {
    this.autoStarts += 1;
  }

  /** That start was refused before any event (NotAllowedError, NotSupportedError). */
  autoStartRefused(): void {
    this.autoStarts = Math.max(0, this.autoStarts - 1);
  }

  /** Just before the page's own `pause()` on a playing video. */
  askedPause(): void {
    this.askedPauses += 1;
  }

  /** A `play` event: true when the autoplay rule asked for it, false when the visitor did. */
  onPlay(): boolean {
    if (this.autoStarts === 0) return false;
    this.autoStarts -= 1;
    return true;
  }

  /** A `pause` event: true when the page asked for it, false when the visitor did (or the file ended). */
  onPause(): boolean {
    if (this.askedPauses === 0) return false;
    this.askedPauses -= 1;
    return true;
  }
}

export interface AutoplayEntry {
  readonly id: string;
  readonly share: number;
  readonly layer: number;
}

/**
 * Which video plays by itself: of those at least `threshold` in view on a layer at or above
 * `minLayer`, the one on the highest layer and most in view. Shares are compared in steps of `step`
 * (the threshold itself is exact); between equals, `current` keeps playing, else the earliest in
 * `entries`. Null when none qualifies.
 */
export function pickAutoplay(
  entries: readonly AutoplayEntry[],
  current: string | null,
  minLayer: number,
  threshold: number,
  step: number,
): string | null {
  let best: AutoplayEntry | null = null;
  let bestRank = -1;
  for (const entry of entries) {
    if (entry.layer < minLayer || !(entry.share >= threshold)) continue;
    const rank = Math.round(entry.share / step);
    const wins =
      best === null ||
      entry.layer > best.layer ||
      (entry.layer === best.layer && (rank > bestRank || (rank === bestRank && entry.id === current)));
    if (wins) {
      best = entry;
      bestRank = rank;
    }
  }
  return best ? best.id : null;
}

/**
 * The share of a video in view, from an IntersectionObserver entry: its intersection ratio, except
 * that a video taller than the view counts as wholly in view when it fills the view (it can never
 * be more in view than that).
 */
export function viewShare(ratio: number, height: number, viewHeight: number): number {
  if (!(ratio > 0)) return 0;
  const most = height > 0 && viewHeight > 0 && height > viewHeight ? viewHeight / height : 1;
  return Math.min(1, ratio / most);
}

/** The IntersectionObserver thresholds that measure the share in steps of `step`, `inView` among them. */
export function shareThresholds(step: number, inView: number): number[] {
  const count = Math.max(1, Math.round(1 / step));
  const list = Array.from({ length: count + 1 }, (_, i) => i / count);
  if (!list.includes(inView)) list.push(inView);
  return list.sort((a, b) => a - b);
}

/** A layer at `top` covers a player that shows on a layer under it; a player with nothing to see, never. */
function coveredBy(player: Player, top: number): boolean {
  return player.layer !== null && player.layer < top;
}

function pauseOthers(id: string): void {
  players.forEach((player, other) => {
    if (other !== id) player.pause();
  });
}

function audioPlaying(): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.getElementsByTagName('audio')).some((audio) => !audio.paused && !audio.ended);
}

/** Media events do not bubble, so the document hears an audio element stop in the capture phase. */
function onMediaStop(event: Event): void {
  if (!(event.target instanceof HTMLAudioElement) || hold?.until !== 'audio') return;
  if (!audioPlaying()) setHold(null);
}

function hearAudio(on: boolean): void {
  if (on === hearingAudio || typeof document === 'undefined') return;
  hearingAudio = on;
  for (const type of ['pause', 'ended']) {
    if (on) document.addEventListener(type, onMediaStop, true);
    else document.removeEventListener(type, onMediaStop, true);
  }
}

function setHold(next: Hold | null): void {
  hold = next;
  hearAudio(next?.until === 'audio');
  settle();
}

function held(): boolean {
  if (!hold) return false;
  return hold.until === 'audio' ? audioPlaying() : true;
}

/** Starts and stops videos so that the right one, or none, plays by itself. */
function settle(): void {
  const entries = Array.from(candidates, ([id, entry]) => ({ id, share: entry.share, layer: entry.layer }));
  const next = held() ? null : pickAutoplay(entries, current, depth, media.video.inView, media.video.shareStep);
  if (next === current) return;
  const previous = current;
  current = next;
  if (previous !== null) candidates.get(previous)?.stop();
  if (next !== null) candidates.get(next)?.play();
}
