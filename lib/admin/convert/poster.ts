/**
 * Video posters (ARCHITECTURE.md 13A: "a poster frame is captured at upload"): the frame at one
 * second, or at a tenth of a shorter video, is drawn from a muted <video> element playing the file
 * from an object URL, and stored as a WebP of at most 1920 px on the long side. Model and document
 * posters are drawn by their own modules (model.ts, document.ts) and encoded the same way.
 */
import { abortError, fitWithin, POSTER_QUALITY, type PrepareContext } from './util';
import { createRaster, drawInto, encodeWebP, releaseRaster } from './webp';

/** How long the browser gets to open the video and to seek in it. */
const VIDEO_EVENT_TIMEOUT_MS = 20_000;

export interface Poster {
  blob: Blob;
  width: number;
  height: number;
}

/** The time of the poster frame: one second in, or a tenth of the video when it is shorter. */
export function posterTime(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(1, durationSec * 0.1);
}

/** Resolves on the event, rejects on an error event, a timeout, or an abort. */
function once(video: HTMLVideoElement, event: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onEvent = () => {
      done();
      resolve();
    };
    const onError = () => {
      done();
      reject(new Error('The video could not be played in this browser.'));
    };
    const onAbort = () => {
      done();
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('The video did not respond in time.'));
    }, VIDEO_EVENT_TIMEOUT_MS);
    video.addEventListener(event, onEvent);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Draws one frame of a video file into a WebP poster. Returns null when this browser cannot play
 * the video (an H.265 file in a browser without H.265, for example).
 */
export async function captureVideoPoster(file: Blob, context: PrepareContext, maxSide: number): Promise<Poster | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  // Some browsers only decode frames for an element in the document; this one is never seen.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  context.cleanup.add(() => {
    video.removeAttribute('src');
    video.load();
    video.remove();
  });
  try {
    const loaded = once(video, 'loadeddata', context.signal);
    video.src = context.cleanup.url(file);
    await loaded;
    const time = posterTime(video.duration);
    if (time > 0 && Math.abs(video.currentTime - time) > 0.01) {
      const seeked = once(video, 'seeked', context.signal);
      video.currentTime = time;
      await seeked;
    }
    if (!video.videoWidth || !video.videoHeight) return null;
    const size = fitWithin(video.videoWidth, video.videoHeight, maxSide);
    const raster = createRaster(size.width, size.height);
    try {
      drawInto(raster, video);
      const blob = await encodeWebP(raster, { quality: POSTER_QUALITY });
      return { blob, width: size.width, height: size.height };
    } finally {
      releaseRaster(raster);
    }
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}
