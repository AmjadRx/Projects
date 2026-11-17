/**
 * The audio waveform: its peaks, and the drawing of them on a canvas. Loaded only with the audio
 * engine, never in a page's first load.
 *
 * Peaks are computed once, at upload (ARCHITECTURE.md 13A), and stored with the media as
 * `waveform` (lib/schema.ts). The public player only draws them: it never downloads or decodes a
 * file to make a waveform.
 */

/** Peaks per file. The drawing groups them into bars to fit the canvas. */
const BUCKETS = 1200;

/**
 * Decoding resamples to the context's rate. A low rate keeps a long file's decoded copy small
 * (ten minutes at 8 kHz is about 19 MB), and peaks need no more detail than that.
 */
const DECODE_RATES = [8000, 22050, 44100];

type OfflineContextConstructor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function decodingContext(): OfflineAudioContext {
  const scope = window as Window & { webkitOfflineAudioContext?: OfflineContextConstructor };
  const Context: OfflineContextConstructor | undefined = window.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  if (!Context) throw new Error('Web Audio is not available.');
  for (const rate of DECODE_RATES) {
    try {
      return new Context(1, 1, rate);
    } catch {
      // Some browsers refuse low rates; try the next one.
    }
  }
  throw new Error('No sample rate was accepted.');
}

function decode(context: OfflineAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Older Safari only calls back; newer browsers also return a promise. Either settles once.
    const result = context.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.then(resolve, reject);
  });
}

/**
 * Fetches the file, decodes it, and returns its peaks, normalized to the loudest one (0 to 1).
 *
 * For the Phase 6 admin only: it runs in the owner's browser when he uploads an audio file, and
 * its result is stored as the media's `waveform`. The public audio engine must never call it.
 */
export async function computePeaks(src: string, signal: AbortSignal): Promise<Float32Array> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`The file returned ${response.status}.`);
  const data = await response.arrayBuffer();
  const buffer = await decode(decodingContext(), data);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const length = buffer.length;
  const buckets = Math.max(1, Math.min(BUCKETS, length));
  const size = length / buckets;
  // Long files are sampled with a stride: the drawing cannot show finer detail anyway.
  const stride = Math.max(1, Math.floor(size / 256));
  const peaks = new Float32Array(buckets);
  let loudest = 0;
  for (let b = 0; b < buckets; b += 1) {
    const start = Math.floor(b * size);
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * size)));
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += stride) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
      }
    }
    peaks[b] = peak;
    if (peak > loudest) loudest = peak;
  }
  if (loudest > 0) for (let b = 0; b < buckets; b += 1) peaks[b] /= loudest;
  return peaks;
}

export interface WaveColors {
  played: string;
  rest: string;
  head: string;
}

/** Colors from the well's ink token, so the waveform follows the theme. */
export function readWaveColors(element: Element): WaveColors {
  const raw = getComputedStyle(element).getPropertyValue('--well-ink').trim();
  const parts = raw.split(/[\s,/]+/).map(Number);
  const [r, g, b] = parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? parts : [255, 255, 255];
  return {
    played: `rgba(${r}, ${g}, ${b}, 0.95)`,
    rest: `rgba(${r}, ${g}, ${b}, 0.34)`,
    head: `rgba(${r}, ${g}, ${b}, 1)`,
  };
}

const BAR = 2;
const GAP = 1;

/** Draws the peaks (0 to 1) as bars around the middle line; bars before `progress` (0 to 1) are played. */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: ArrayLike<number>, progress: number, colors: WaveColors): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const step = BAR + GAP;
  const count = Math.max(1, Math.floor((width + GAP) / step));
  const middle = height / 2;
  const reach = Math.max(1, middle - 2);
  const playedX = Math.min(1, Math.max(0, progress)) * width;
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor((i / count) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j += 1) if (peaks[j] > peak) peak = peaks[j];
    const half = Math.max(1, peak * reach);
    const x = i * step;
    context.fillStyle = x + BAR / 2 <= playedX ? colors.played : colors.rest;
    context.fillRect(x, middle - half, BAR, half * 2);
  }
  if (progress > 0 && progress < 1) {
    context.fillStyle = colors.head;
    context.fillRect(Math.max(0, Math.round(playedX) - 1), 0, 2, height);
  }
}
