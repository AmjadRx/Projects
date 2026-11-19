/**
 * Video (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, R-18, Q-20). mediabunny reads the codec, the
 * size, and the duration. MP4 and MOV files are re-wrapped as MP4 with their packets copied, never
 * encoded again, which leaves the container's metadata (place, device, dates) behind. A sound track
 * browsers cannot play from MP4 (the PCM audio of many cameras) is converted to AAC; one this
 * browser cannot decode (AC-3 without a decoder, ALAC, AMR) would leave the video silent, which the
 * owner must accept first. WebM is kept as it is, with a warning when it carries descriptive tags.
 * H.265 (HEVC) asks for an H.264 export with a warning the owner must accept. The poster is a frame
 * drawn from a <video> element.
 */
import type { Detected } from './detect';
import { CONVERT_MESSAGES as M, detailOf } from './messages';
import { captureVideoPoster } from './poster';
import { PrepareError, type PreparedPart, type PreparedUpload } from './types';
import {
  abortError,
  isAbortError,
  originalOf,
  outputName,
  posterName,
  throwIfAborted,
  VIDEO_POSTER_MAX_SIDE,
  type PrepareContext,
} from './util';

type Mediabunny = typeof import('mediabunny');
type MediabunnyInput = InstanceType<Mediabunny['Input']>;

/** Video codecs an MP4 file can carry and some browser plays; anything else asks for an export. */
const MP4_VIDEO_CODECS = new Set(['avc', 'hevc', 'vp9', 'av1']);
/** Sound codecs copied as they are; any other sound track is converted to AAC. */
const COPIED_AUDIO_CODECS = new Set(['aac', 'mp3']);

/** The short codec tag ("avc1", "hvc1", "vp09") from the codec string, or from the codec's name. */
export function codecTagOf(codec: string | null, parameterString: string | null): string {
  const fromString = parameterString?.split('.')[0]?.trim();
  if (fromString) return fromString;
  switch (codec) {
    case 'avc':
      return 'avc1';
    case 'hevc':
      return 'hvc1';
    case 'vp9':
      return 'vp09';
    case 'av1':
      return 'av01';
    case 'vp8':
      return 'vp8';
    default:
      return codec ?? 'unknown';
  }
}

/**
 * Raw tags that only name the program that wrote the file, which are not personal: container
 * fields, Matroska's writing and muxing apps, ID3's TSSE (encoder settings), and MP4's "©too"
 * (encoding tool).
 */
const TECHNICAL_TAGS =
  /^(encoder|encoder_options|encoded_by|duration|handler_name|vendor_id|major_brand|minor_version|compatible_brands|writing_app|muxing_app|language|tsse|©too)$/i;

type Tags = Awaited<ReturnType<MediabunnyInput['getMetadataTags']>>;

/**
 * The descriptive words in a file's tags (title, artist, comment, ...), each once, for the content
 * check. A raw tag that repeats a common one (MP4's "©nam" beside the title) is not listed twice.
 */
export function descriptiveTagText(tags: Partial<Tags> | null | undefined): string[] {
  if (!tags) return [];
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.add(value.trim());
  };
  for (const key of ['title', 'description', 'artist', 'albumArtist', 'album', 'genre', 'comment', 'lyrics'] as const) add(tags[key]);
  if (tags.date instanceof Date && !Number.isNaN(tags.date.getTime())) out.add(tags.date.toISOString().slice(0, 10));
  for (const [key, value] of Object.entries(tags.raw ?? {})) {
    if (TECHNICAL_TAGS.test(key)) continue;
    if (Array.isArray(value)) for (const item of value) add(item);
    else add(value);
  }
  return [...out];
}

/** True when tags hold anything personal: descriptive words or embedded pictures. */
export function hasPersonalTags(tags: Partial<Tags> | null | undefined): boolean {
  return descriptiveTagText(tags).length > 0 || (tags?.images?.length ?? 0) > 0;
}

let aacRegistered = false;

/** Makes sure mediabunny can encode AAC: WebCodecs when the browser has it, else the WebAssembly encoder (Q-21). */
export async function ensureAacEncoder(mediabunny: Mediabunny, numberOfChannels: number, sampleRate: number): Promise<void> {
  if (aacRegistered) return;
  if (await mediabunny.canEncodeAudio('aac', { numberOfChannels, sampleRate }).catch(() => false)) return;
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  aacRegistered = true;
}

type MediabunnyConversion = Awaited<ReturnType<Mediabunny['Conversion']['init']>>;

/** What a set-up conversion does with the sound: whether it is written, and whether it was dropped. */
export interface SoundOutcome {
  /** A sound track is written to the output. */
  kept: boolean;
  /** A sound track was left out for a reason other than the caller's choice (a codec this browser cannot decode). */
  dropped: boolean;
}

/** Reads, before it runs, what a conversion will do with the sound tracks it was given. */
export function soundOutcomeOf(conversion: Pick<MediabunnyConversion, 'utilizedTracks' | 'discardedTracks'>): SoundOutcome {
  return {
    kept: conversion.utilizedTracks.some((track) => track.type === 'audio'),
    dropped: conversion.discardedTracks.some((entry) => entry.track.type === 'audio' && entry.reason !== 'discarded_by_user'),
  };
}

/**
 * Runs a mediabunny conversion into an in-memory MP4 (moov first, so playback can start early).
 * `inspect` sees the conversion once it is set up, before any packet moves: which tracks it
 * writes and which it had to leave out.
 */
export async function convertToMp4(
  mediabunny: Mediabunny,
  options: Omit<Parameters<Mediabunny['Conversion']['init']>[0], 'output'>,
  context: PrepareContext,
  stage: string,
  inspect?: (conversion: MediabunnyConversion) => void,
): Promise<ArrayBuffer> {
  const { Conversion, Output, Mp4OutputFormat, BufferTarget } = mediabunny;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const conversion = await Conversion.init({ ...options, output, showWarnings: false });
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((track) => track.reason).join(', ');
    throw new Error(reasons || 'no track can be written to MP4');
  }
  inspect?.(conversion);
  conversion.onProgress = (fraction) => context.progress(stage, fraction);
  const onAbort = () => void conversion.cancel();
  context.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await conversion.execute();
  } catch (error) {
    if (context.signal?.aborted) throw abortError(context.signal);
    throw error;
  } finally {
    context.signal?.removeEventListener('abort', onAbort);
  }
  if (!target.buffer) throw new Error('the converter wrote nothing');
  return target.buffer;
}

/** Prepares a video: MP4 (re-wrapped) or WebM (as it is), with its poster and details. */
export async function prepareVideo(file: File, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('decode');
  const mediabunny = await import('mediabunny');
  const input = new mediabunny.Input({ source: new mediabunny.BlobSource(file), formats: mediabunny.ALL_FORMATS });
  context.cleanup.add(() => input.dispose());

  let track: Awaited<ReturnType<MediabunnyInput['getPrimaryVideoTrack']>>;
  try {
    track = await input.getPrimaryVideoTrack();
  } catch (error) {
    if (isAbortError(error, context.signal)) throw error;
    throw new PrepareError('video-unreadable', file.name, M.videoUnreadable);
  }
  if (!track) {
    // An MP4 or MOV that holds only sound is an audio file.
    if (await input.getPrimaryAudioTrack().catch(() => null)) {
      const { prepareIsoAudio } = await import('./audio');
      return prepareIsoAudio(file, detected, input, context);
    }
    throw new PrepareError('video-no-track', file.name, M.videoNoTrack);
  }

  const codec = await track.getCodec();
  const codecTag = codecTagOf(codec, await track.getCodecParameterString().catch(() => null));
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();
  const duration = await input.computeDuration().catch(() => 0);
  throwIfAborted(context.signal);
  if (codec === 'hevc') context.warn('hevc', M.hevc, true);

  let stored: Blob;
  let ext: string;
  let tagText: string[] = [];
  if (detected.format === 'webm') {
    const tags = await input.getMetadataTags().catch(() => null);
    if (hasPersonalTags(tags)) {
      context.warn('webm-metadata', M.webmMetadata, true);
      tagText = descriptiveTagText(tags);
    }
    stored = new Blob([file], { type: 'video/webm' });
    ext = 'webm';
  } else {
    if (!codec || !MP4_VIDEO_CODECS.has(codec)) {
      throw new PrepareError('video-codec', file.name, M.videoCodec(codecTag));
    }
    context.progress('convert', 0);
    // The sound callback runs before mediabunny decides whether it can decode the track, so what
    // happened to the sound is read from the conversion once it is set up (SoundOutcome).
    let transcodedAudio = false;
    let sound: SoundOutcome = { kept: false, dropped: false };
    try {
      const buffer = await convertToMp4(
        mediabunny,
        {
          input,
          tracks: 'primary',
          // Copy every packet; any start offset is allowed, so nothing is ever encoded again.
          copy: { mode: 'preferred', shiftTolerance: Infinity },
          video: {},
          audio: async (audioTrack) => {
            const audioCodec = await audioTrack.getCodec();
            if (audioCodec && COPIED_AUDIO_CODECS.has(audioCodec)) return {};
            const channels = Math.min(2, await audioTrack.getNumberOfChannels());
            const sampleRate = (await audioTrack.getSampleRate()) === 44_100 ? 44_100 : 48_000;
            await ensureAacEncoder(mediabunny, channels, sampleRate);
            transcodedAudio = true;
            return { codec: 'aac', numberOfChannels: channels, sampleRate, quality: mediabunny.QUALITY_HIGH };
          },
          // No title, place, device, or date is written; only the packets move.
          tags: { creationTime: null },
        },
        context,
        'convert',
        (conversion) => {
          sound = soundOutcomeOf(conversion);
        },
      );
      stored = new Blob([buffer], { type: 'video/mp4' });
    } catch (error) {
      if (isAbortError(error, context.signal)) throw error;
      throw new PrepareError('video-remux-failed', file.name, M.videoRemuxFailed(detailOf(error)));
    }
    // A sound track this browser cannot decode is left out: the owner decides on a silent video.
    if (sound.dropped) context.warn('sound-dropped', M.soundDropped, true);
    if (transcodedAudio && sound.kept && !sound.dropped) context.warn('sound-converted', M.soundConverted);
    ext = 'mp4';
  }

  throwIfAborted(context.signal);
  context.progress('poster');
  const poster = await captureVideoPoster(stored, context, VIDEO_POSTER_MAX_SIDE);
  if (!poster) context.warn('no-poster', M.noVideoPoster);

  const parts: PreparedPart[] = [{ role: 'main', name: outputName(file.name, ext), blob: stored, contentType: `video/${ext}` }];
  if (poster) parts.push({ role: 'poster', name: posterName(file.name), blob: poster.blob, contentType: 'image/webp' });
  return {
    kind: 'video',
    mediaKind: 'video',
    original: originalOf(file),
    parts,
    meta: {
      width: poster?.width ?? width,
      height: poster?.height ?? height,
      durationSec: Math.round(duration * 1000) / 1000,
      codec: codecTag,
      ...(tagText.length > 0 ? { text: tagText.join('\n') } : {}),
    },
    warnings: context.warnings,
  };
}
