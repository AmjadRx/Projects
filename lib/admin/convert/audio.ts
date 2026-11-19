/**
 * Audio (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, Q-20, Q-21): MP3 and M4A are kept as they
 * are, so a file whose tags hold a title, a name, or a date asks the owner to confirm; WAV is
 * converted to AAC in an .m4a file through mediabunny (WebCodecs when the browser can encode
 * AAC, else the WebAssembly encoder, loaded only then). Every file gets its waveform: 1024 peaks
 * of the absolute amplitude, the loudest at 1, computed once here so that visitors never decode a
 * file to draw one (components/viewers/audio/waveform.ts draws them).
 */
import type { Detected } from './detect';
import { CONVERT_MESSAGES as M, detailOf } from './messages';
import { PrepareError, type PreparedUpload } from './types';
import { abortable, isAbortError, originalOf, outputName, throwIfAborted, WAVEFORM_BUCKETS, type PrepareContext } from './util';
import { convertToMp4, descriptiveTagText, ensureAacEncoder, hasPersonalTags } from './video';

type Mediabunny = typeof import('mediabunny');
type MediabunnyInput = InstanceType<Mediabunny['Input']>;

/** Sound codecs kept as they are inside an .m4a file. */
const KEPT_ISO_CODECS = new Set(['aac', 'mp3']);

/**
 * Peaks for the waveform: the samples split into `buckets` equal runs, each run's largest absolute
 * value across all channels, divided by the loudest run's, rounded to three decimals. Silence
 * gives zeros. Fewer samples than buckets give one peak per sample.
 */
export function peaksOf(channels: readonly ArrayLike<number>[], buckets = WAVEFORM_BUCKETS): number[] {
  const length = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  if (length === 0) return [];
  const count = Math.max(1, Math.min(buckets, length));
  const raw = new Float64Array(count);
  let loudest = 0;
  for (let b = 0; b < count; b += 1) {
    const start = Math.floor((b * length) / count);
    const end = Math.max(start + 1, Math.floor(((b + 1) * length) / count));
    let peak = 0;
    for (const channel of channels) {
      const stop = Math.min(end, channel.length);
      for (let i = start; i < stop; i += 1) {
        const value = Math.abs(channel[i]);
        if (value > peak) peak = value;
      }
    }
    raw[b] = peak;
    if (peak > loudest) loudest = peak;
  }
  const peaks = new Array<number>(count);
  for (let b = 0; b < count; b += 1) {
    peaks[b] = loudest > 0 ? Math.min(1, Math.round((raw[b] / loudest) * 1000) / 1000) : 0;
  }
  return peaks;
}

/**
 * Decoding resamples to the context's rate; a low rate keeps a long file's decoded copy small (an
 * hour at 8 kHz is about 115 MB per channel), and the waveform needs no more detail than that.
 */
const DECODE_RATES = [8000, 22_050, 44_100];

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

/** Decodes a file and returns its waveform and duration, or null when this browser cannot decode it. */
export async function waveformOf(file: Blob, context: PrepareContext): Promise<{ peaks: number[]; durationSec: number } | null> {
  try {
    const data = await file.arrayBuffer();
    const decoder = decodingContext();
    const buffer = await abortable(
      new Promise<AudioBuffer>((resolve, reject) => {
        // Older Safari only calls back; newer browsers also return a promise. Either settles once.
        const result = decoder.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
        result?.then(resolve, reject);
      }),
      context.signal,
    );
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return { peaks: peaksOf(channels), durationSec: Math.round(buffer.duration * 1000) / 1000 };
  } catch (error) {
    if (isAbortError(error, context.signal)) throw error;
    return null;
  }
}

async function finish(
  file: File,
  stored: Blob,
  ext: 'mp3' | 'm4a',
  measured: Blob,
  tagText: string[],
  context: PrepareContext,
  durationHint: number,
): Promise<PreparedUpload> {
  throwIfAborted(context.signal);
  context.progress('poster');
  const wave = await waveformOf(measured, context);
  if (!wave || wave.peaks.length === 0) context.warn('no-waveform', M.noWaveform);
  const contentType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
  const durationSec = wave?.durationSec ?? Math.round(durationHint * 1000) / 1000;
  return {
    kind: 'audio',
    mediaKind: 'audio',
    original: originalOf(file),
    parts: [{ role: 'main', name: outputName(file.name, ext), blob: stored, contentType }],
    meta: {
      ...(durationSec > 0 ? { durationSec } : {}),
      ...(wave && wave.peaks.length > 0 ? { waveform: wave.peaks } : {}),
      ...(tagText.length > 0 ? { text: tagText.join('\n') } : {}),
    },
    warnings: context.warnings,
  };
}

/** Converts the sound of an input to AAC in an MP4 file (or copies it when it already is AAC or MP3). */
async function toM4a(mediabunny: Mediabunny, input: MediabunnyInput, file: File, context: PrepareContext, copy: boolean): Promise<Blob> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new PrepareError('audio-no-track', file.name, M.audioNoTrack);
  const channels = Math.min(2, await track.getNumberOfChannels());
  const sampleRate = (await track.getSampleRate()) === 44_100 ? 44_100 : 48_000;
  if (!copy) await ensureAacEncoder(mediabunny, channels, sampleRate);
  context.progress('convert', 0);
  try {
    const buffer = await convertToMp4(
      mediabunny,
      {
        input,
        tracks: 'primary',
        video: { discard: true },
        audio: copy ? {} : { codec: 'aac', numberOfChannels: channels, sampleRate, quality: mediabunny.QUALITY_HIGH },
        copy: { mode: 'preferred', shiftTolerance: Infinity },
        tags: { creationTime: null },
      },
      context,
      'convert',
    );
    return new Blob([buffer], { type: 'audio/mp4' });
  } catch (error) {
    if (isAbortError(error, context.signal)) throw error;
    if (!copy && /encod/i.test(detailOf(error))) throw new PrepareError('aac-unavailable', file.name, M.aacUnavailable);
    throw new PrepareError('audio-unreadable', file.name, `${M.audioUnreadable} (${detailOf(error)})`);
  }
}

/** Prepares an MP3 (kept) or a WAV (converted to AAC). */
export async function prepareAudio(file: File, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('decode');
  const mediabunny = await import('mediabunny');
  const input = new mediabunny.Input({ source: new mediabunny.BlobSource(file), formats: mediabunny.ALL_FORMATS });
  context.cleanup.add(() => input.dispose());
  let duration = 0;
  try {
    if (!(await input.getPrimaryAudioTrack())) throw new PrepareError('audio-no-track', file.name, M.audioNoTrack);
    duration = await input.computeDuration().catch(() => 0);
  } catch (error) {
    if (error instanceof PrepareError || isAbortError(error, context.signal)) throw error;
    throw new PrepareError('audio-unreadable', file.name, M.audioUnreadable);
  }
  if (detected.format === 'mp3') {
    const tags = await input.getMetadataTags().catch(() => null);
    // Kept as it is (ARCHITECTURE.md 13A), so its tags stay: the owner confirms they may be public (D-24).
    if (hasPersonalTags(tags)) context.warn('audio-metadata', M.audioMetadata, true);
    return finish(file, new Blob([file], { type: 'audio/mpeg' }), 'mp3', file, descriptiveTagText(tags), context, duration);
  }
  // WAV: the waveform comes from the original samples, which every browser decodes.
  const m4a = await toM4a(mediabunny, input, file, context, false);
  return finish(file, m4a, 'm4a', file, [], context, duration);
}

/** Prepares an MP4, M4A, or MOV file that holds only sound (handed over by the video module). */
export async function prepareIsoAudio(
  file: File,
  detected: Detected,
  input: MediabunnyInput,
  context: PrepareContext,
): Promise<PreparedUpload> {
  const mediabunny = await import('mediabunny');
  const track = await input.getPrimaryAudioTrack();
  const codec = track ? await track.getCodec() : null;
  const duration = await input.computeDuration().catch(() => 0);
  if (detected.format === 'mp4' && codec && KEPT_ISO_CODECS.has(codec)) {
    const tags = await input.getMetadataTags().catch(() => null);
    if (hasPersonalTags(tags)) context.warn('audio-metadata', M.audioMetadata, true);
    return finish(file, new Blob([file], { type: 'audio/mp4' }), 'm4a', file, descriptiveTagText(tags), context, duration);
  }
  // A QuickTime container, or a sound track browsers cannot play from MP4: re-wrap or convert.
  const copy = codec !== null && KEPT_ISO_CODECS.has(codec);
  const m4a = await toM4a(mediabunny, input, file, context, copy);
  return finish(file, m4a, 'm4a', m4a, [], context, duration);
}
