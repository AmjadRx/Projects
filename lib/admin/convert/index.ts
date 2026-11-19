/**
 * Upload preparation for the admin's media library (ARCHITECTURE.md 13A; the contract is
 * ./types.ts). `prepareUploads` groups the dropped files, recognizes each group from its bytes,
 * converts it in the browser, and returns one PreparedUpload per group, or a PrepareError with a
 * plain message. Groups are prepared one at a time, so a large drop never holds several decoded
 * videos or models in memory at once.
 *
 * This module imports only small, library-free code. Each converter, and every library it uses
 * (mediabunny, libheif-js, @jsquash/webp, pdf.js, JSZip, three.js, glTF-Transform, meshoptimizer,
 * and the occt worker), loads with a dynamic import when a file needs it, so none of them is in any
 * page's first load.
 */
import { detect, type Detected } from './detect';
import { groupFiles } from './group';
import { CONVERT_MESSAGES as M, detailOf } from './messages';
import { prepareCaptions, prepareDrawing, prepareFile, prepareOffice } from './plain';
import { PrepareError, type FileGroup, type PreparedUpload, type PrepareUploads } from './types';
import { abortError, createContext, isAbortError, throwIfAborted, type PrepareContext } from './util';

async function prepareGroup(group: FileGroup, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  const { main } = group;
  switch (detected.format) {
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'avif':
    case 'heic':
      return (await import('./image')).prepareImage(main, detected, context);
    case 'svg':
      return prepareDrawing(main, context);
    case 'mp4':
    case 'mov':
    case 'webm':
      return (await import('./video')).prepareVideo(main, detected, context);
    case 'mp3':
    case 'wav':
      return (await import('./audio')).prepareAudio(main, detected, context);
    case 'pdf':
      return (await import('./document')).preparePdf(main, context);
    case 'docx':
      return (await import('./document')).prepareDocx(main, context);
    case 'office':
      return prepareOffice(main, detected, context);
    case 'glb':
    case 'gltf':
    case 'stl':
    case 'obj':
    case '3mf':
    case 'ply':
    case 'step':
      return (await import('./model')).prepareModel(group, detected, context);
    case 'vtt':
      return prepareCaptions(main, context);
    case 'csv':
    case 'txt':
    case 'zip':
      return prepareFile(main, detected, context);
    case 'mtl':
      throw new PrepareError('companion-alone', main.name, M.companionAlone(main.name));
  }
}

/**
 * Prepares dropped files for upload. Progress arrives through `options.onProgress`; aborting
 * `options.signal` stops the work (workers are terminated, object URLs revoked) and rejects with
 * the abort reason.
 */
export const prepareUploads: PrepareUploads = async (files, options = {}) => {
  const { signal } = options;
  throwIfAborted(signal);
  const groups = await groupFiles(files);
  const prepared: PreparedUpload[] = [];
  const failed: PrepareError[] = [];
  for (const group of groups) {
    throwIfAborted(signal);
    const context = createContext(group.main.name, options);
    try {
      context.progress('detect');
      const detected = await detect(group.main);
      const result = await prepareGroup(group, detected, context);
      throwIfAborted(signal);
      prepared.push(result);
    } catch (error) {
      // Only the caller's abort stops the whole drop; any other failure belongs to this file.
      if (signal?.aborted) throw abortError(signal);
      if (error instanceof PrepareError) failed.push(error);
      else if (isAbortError(error)) failed.push(new PrepareError('failed', group.main.name, M.failed('it was cancelled')));
      else failed.push(new PrepareError('failed', group.main.name, M.failed(detailOf(error))));
    } finally {
      context.cleanup.run();
      context.progress('done', 1);
    }
  }
  return { prepared, failed };
};

export { PrepareError } from './types';
export type { PreparedUpload, PreparedPart, PrepareProgress, PrepareOptions, UploadKind } from './types';
