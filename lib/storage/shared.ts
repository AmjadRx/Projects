/** Helpers the storage backends share. Server only. */
import 'server-only';
import { downloadHrefOf } from '../media';
import { STORAGE_MESSAGES as M } from './labels';
import {
  checkFolder,
  checkSizeForStore,
  checkType,
  fileTypeOf,
  repoPathOf,
  sanitizeFileName,
  sitePathOf,
  StorageError,
  type FileType,
  type StoreName,
} from './rules';
import type { Inspector, PutInput, StoredFile } from './types';

/** The environment variables the adapter reads. `process.env` fits. */
export type Env = Readonly<Record<string, string | undefined>>;

/** A variable's value, trimmed, with quotes pasted around it removed (as v2's lib/github.ts reads them). */
export function envValue(env: Env, name: string): string {
  return (env[name] ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

export function toSet(values: Iterable<string> | undefined): ReadonlySet<string> | undefined {
  return values === undefined ? undefined : new Set(values);
}

export function asList(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? [value] : [...value];
}

/** Removes every copy of `secret` from text that may reach the admin (an error detail from GitHub or Blob). */
export function redact(text: string, secret: string): string {
  return secret.length >= 4 ? text.split(secret).join('[hidden]') : text;
}

/** An upstream error message, made short and safe to show: one line, at most 200 characters, no secret. */
export function errorDetail(text: string, secret: string): string {
  return redact(text, secret).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function byName(a: StoredFile, b: StoredFile): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export interface PreparedFile {
  folder: string;
  name: string;
  ext: string;
  type: FileType;
  bytes: Uint8Array;
}

/**
 * Every check before a file is written: folder, cleaned name, type for this store, size for this
 * store, then the route's byte checks (`inspect`). An SVG file without an inspector is refused,
 * because only the inspector can sanitize it (D-24).
 */
export async function prepareFile(
  file: PutInput,
  store: StoreName,
  folders: ReadonlySet<string> | undefined,
  inspect: Inspector | undefined,
): Promise<PreparedFile> {
  if (!file || !(file.bytes instanceof Uint8Array)) throw new StorageError('invalid-size', M.invalidSize, 400);
  const folder = checkFolder(file.folder, folders);
  const { name, ext } = sanitizeFileName(file.name);
  const type = checkType(ext, store);
  checkSizeForStore(file.bytes.byteLength, store);
  if (!inspect) {
    if (type.group === 'drawing') throw new StorageError('svg-not-sanitized', M.svgNotSanitized, 415);
    return { folder, name, ext, type, bytes: file.bytes };
  }
  const bytes = await inspect({ folder, name, ext, type, store, bytes: file.bytes });
  if (!(bytes instanceof Uint8Array)) throw new StorageError('inspect-failed', M.inspectFailed, 500);
  checkSizeForStore(bytes.byteLength, store);
  return { folder, name, ext, type, bytes };
}

/** `prepareFile` for a batch, refusing two files that would get the same name in the same folder. */
export async function prepareAll(
  files: readonly PutInput[],
  store: StoreName,
  folders: ReadonlySet<string> | undefined,
  inspect: Inspector | undefined,
): Promise<PreparedFile[]> {
  const prepared: PreparedFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const ready = await prepareFile(file, store, folders, inspect);
    const key = `${ready.folder}/${ready.name}`;
    if (seen.has(key)) throw new StorageError('exists', M.duplicateInBatch(ready.name), 409);
    seen.add(key);
    prepared.push(ready);
  }
  return prepared;
}

/** A repository file as the adapter reports it. */
export function storedRepoFile(folder: string, name: string, size?: number): StoredFile {
  const src = sitePathOf(folder, name);
  const type = fileTypeOf(name);
  return {
    store: 'repo',
    folder,
    name,
    pathname: repoPathOf(folder, name),
    src,
    downloadHref: downloadHrefOf(src),
    ...(size !== undefined ? { size } : {}),
    ...(type ? { contentType: type.contentType } : {}),
  };
}
