'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { prepareUploads } from '@/lib/admin/convert';
import type { PrepareError, PreparedUpload, PrepareProgress } from '@/lib/admin/convert/types';

/**
 * The upload preparation harness (`/dev-convert`, development only): a file input that runs
 * prepareUploads on the chosen files and lists, for each result, its kind, its parts (name, type,
 * size), its details, its warnings, and its poster. Playwright drives it with setInputFiles and
 * reads the results from window.__convert, including the parts' bytes.
 *
 * window.__convert:
 *   runs        how many runs have finished (successfully or not)
 *   running     true while a run is in progress
 *   results     the last run's { prepared, failed }, with the parts' Blobs
 *   error       the last run's rejection, when it rejected (an abort, for example)
 *   progress    every progress event of the last run
 *   run(files)  starts a run on any File list (the input's change handler calls it too)
 *   abort()     aborts the current run
 *   bytes(i, j) the bytes of part j of prepared upload i, base64-encoded
 *   checkModel(i) loads prepared upload i's GLB through the site's own viewer loader
 *              (components/viewers/model/loader.ts) and returns its node and mesh names
 */
interface Harness {
  runs: number;
  running: boolean;
  results: { prepared: PreparedUpload[]; failed: PrepareError[] } | null;
  error: string | null;
  progress: PrepareProgress[];
  run: (files: File[]) => Promise<void>;
  abort: () => void;
  bytes: (upload: number, part: number) => Promise<string>;
  checkModel: (upload: number) => Promise<{ nodes: string[]; meshes: string[]; triangles: number }>;
}

declare global {
  interface Window {
    __convert?: Harness;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

interface Shown {
  upload: PreparedUpload;
  posterUrl: string | null;
}

export default function ConvertHarness() {
  const [shown, setShown] = useState<Shown[]>([]);
  const [failed, setFailed] = useState<PrepareError[]>([]);
  const [status, setStatus] = useState('Choose files to prepare.');
  const [last, setLast] = useState<PrepareProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const harness = useRef<Harness | null>(null);

  const run = useCallback(async (files: File[]) => {
    const state = harness.current;
    if (!state) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    state.running = true;
    state.results = null;
    state.error = null;
    state.progress = [];
    setStatus(`Preparing ${files.length} file(s)...`);
    const started = performance.now();
    try {
      const results = await prepareUploads(files, {
        signal: abort.signal,
        onProgress: (progress) => {
          state.progress.push(progress);
          setLast(progress);
        },
      });
      state.results = results;
      setShown((previous) => {
        for (const item of previous) if (item.posterUrl) URL.revokeObjectURL(item.posterUrl);
        return results.prepared.map((upload) => {
          const poster = upload.parts.find((part) => part.role === 'poster');
          return { upload, posterUrl: poster ? URL.createObjectURL(poster.blob) : null };
        });
      });
      setFailed(results.failed);
      setStatus(`Done in ${Math.round(performance.now() - started)} ms: ${results.prepared.length} prepared, ${results.failed.length} failed.`);
    } catch (error) {
      state.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      setStatus(`Stopped: ${state.error}`);
    } finally {
      state.running = false;
      state.runs += 1;
    }
  }, []);

  useEffect(() => {
    const state: Harness = {
      runs: 0,
      running: false,
      results: null,
      error: null,
      progress: [],
      run,
      abort: () => controller.current?.abort(),
      bytes: async (upload, part) => {
        const blob = state.results?.prepared[upload]?.parts[part]?.blob;
        if (!blob) throw new Error('No such part.');
        return base64(new Uint8Array(await blob.arrayBuffer()));
      },
      checkModel: async (upload) => {
        const blob = state.results?.prepared[upload]?.parts.find((part) => part.role === 'main')?.blob;
        if (!blob) throw new Error('No such upload.');
        const { loadModel } = await import('@/components/viewers/model/loader');
        const url = URL.createObjectURL(blob);
        try {
          const gltf = await loadModel(url);
          const nodes: string[] = [];
          const meshes: string[] = [];
          let triangles = 0;
          gltf.scene.traverse((object) => {
            if (object.name) nodes.push(object.name);
            const mesh = object as unknown as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } } };
            if (mesh.isMesh && mesh.geometry) {
              meshes.push(object.name);
              triangles += Math.floor((mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3);
            }
          });
          return { nodes, meshes, triangles };
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    };
    harness.current = state;
    window.__convert = state;
    return () => {
      controller.current?.abort();
      if (window.__convert === state) delete window.__convert;
    };
  }, [run]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void run(files);
  };

  return (
    <main style={{ padding: 24, maxWidth: 1100 }}>
      <h1>Upload preparation</h1>
      <p>Development only. Files are prepared in this browser and never uploaded.</p>
      <p>
        <input type="file" multiple onChange={onChange} data-testid="files" aria-label="Files to prepare" />{' '}
        <button type="button" onClick={() => controller.current?.abort()}>
          Cancel
        </button>
      </p>
      <p data-testid="status">{status}</p>
      {last ? (
        <p data-testid="progress">
          {last.file}: {last.stage}
          {last.fraction !== undefined ? ` ${Math.round(last.fraction * 100)}%` : ''}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <section>
          <h2>Not prepared</h2>
          <ul>
            {failed.map((error, i) => (
              <li key={`${error.file}-${i}`}>
                <strong>{error.file}</strong> ({error.code}): {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shown.map(({ upload, posterUrl }, i) => (
        <section key={`${upload.original.name}-${i}`} style={{ borderTop: '1px solid', paddingTop: 12, marginTop: 12 }}>
          <h2>
            {upload.original.name}: {upload.kind}
            {upload.mediaKind ? ` (${upload.mediaKind})` : ''}
          </h2>
          <ul>
            {upload.parts.map((part) => (
              <li key={part.name}>
                {part.role}: {part.name}, {part.contentType}, {part.blob.size.toLocaleString('en-US')} bytes
              </li>
            ))}
          </ul>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
            {JSON.stringify(
              {
                ...upload.meta,
                waveform: upload.meta.waveform ? `${upload.meta.waveform.length} peaks` : undefined,
                text: upload.meta.text && upload.meta.text.length > 600 ? `${upload.meta.text.slice(0, 600)}...` : upload.meta.text,
              },
              null,
              2,
            )}
          </pre>
          {upload.warnings.length > 0 ? (
            <ul>
              {upload.warnings.map((warning) => (
                <li key={warning.code + warning.message}>
                  {warning.confirm ? 'Needs confirmation: ' : 'Note: '}
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
          {posterUrl ? (
            // A dev harness: the poster is a local object URL, which next/image does not take.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterUrl} alt="" style={{ maxWidth: 480, height: 'auto', display: 'block' }} />
          ) : null}
        </section>
      ))}
    </main>
  );
}
