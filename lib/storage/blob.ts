/**
 * The Vercel Blob backend (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-23, D-24, D-26, D-27, Q-18).
 * Server only.
 *
 * - Active only when BLOB_READ_WRITE_TOKEN is set (OIDC is a later choice, Q-18). The token is
 *   passed to every call, so the SDK never falls back to other credentials.
 * - Every file is public, gets a random suffix, and is never overwritten: files are immutable, and
 *   Replace makes a new object (D-27). Pathnames are `<prefix>/<folder>/<name>`.
 * - SVG is never stored here (D-24, D-26).
 * - `url()` returns the stored address; downloads use Blob's download address through
 *   `downloadHrefOf` in lib/media.ts, because browsers ignore the download attribute across
 *   origins (D-27).
 *
 * `put` here is a server upload, which a Vercel Function caps at a 4.5 MB request body. Large
 * files go from the browser straight to Blob with a token from the Phase 6 token route, which
 * uses `blobPathnameOf` and `BLOB_WRITE_OPTIONS` from ./rules so both paths store files alike.
 */
import 'server-only';
import { del as blobDelete, list as blobList, put as blobPut, type ListBlobResult, type PutBlobResult } from '@vercel/blob';
import { downloadHrefOf } from '../media';
import { STORAGE_MESSAGES as M } from './labels';
import {
  BLOB_WRITE_OPTIONS,
  checkBlobPrefix,
  checkFolder,
  DEFAULT_BLOB_PREFIX,
  fileTypeOf,
  isStoredName,
  REPO_MAX_BYTES,
  StorageError,
} from './rules';
import { asList, byName, errorDetail, prepareAll, toBuffer, toSet, type PreparedFile } from './shared';
import type { MediaStorage, PutInput, PutOptions, StorageOptions, StoredFile } from './types';

const PUBLIC_HOST_SUFFIX = '.public.blob.vercel-storage.com';
/** Above this size a server put goes in parts, as the SDK advises for large files. */
const MULTIPART_FROM = 100_000_000;
const LIST_PAGE = 1000;
const MAX_LIST_PAGES = 100;

export interface BlobStorageOptions extends StorageOptions {
  token: string;
  /** The path prefix, "media" by default. Previews can use their own (D-27). */
  prefix?: string;
}

interface BlobAddress {
  /** What `del` receives: the URL, or the pathname when only a pathname was given. */
  target: string;
  folder: string;
  name: string;
  pathname: string;
  url?: string;
}

export function createBlobStorage(options: BlobStorageOptions): MediaStorage {
  const token = (options.token ?? '').trim();
  if (!token) throw new StorageError('blob-not-configured', M.blobNotConfigured(REPO_MAX_BYTES), 503);
  const prefix = checkBlobPrefix(options.prefix ?? DEFAULT_BLOB_PREFIX);
  const folders = toSet(options.knownFolders);

  function failure(error: unknown): StorageError {
    if (error instanceof StorageError) return error;
    const message = error instanceof Error ? error.message.replace(/^Vercel Blob:\s*/, '') : '';
    return new StorageError('blob-failed', M.blobFailed(errorDetail(message, token)), 502);
  }

  /** A stored address (a public Blob URL) or pathname, read back into its parts. Anything outside `<prefix>/<folder>/` is refused. */
  function parse(value: unknown): BlobAddress {
    const bad = () => new StorageError('bad-path', M.blobBadAddress(String(value)), 400);
    if (typeof value !== 'string' || value === '') throw bad();
    let pathname = value;
    let url: string | undefined;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw bad();
      }
      if (
        parsed.protocol !== 'https:' ||
        !parsed.hostname.endsWith(PUBLIC_HOST_SUFFIX) ||
        parsed.username ||
        parsed.password ||
        parsed.port
      ) {
        throw bad();
      }
      pathname = parsed.pathname.slice(1);
      url = `${parsed.origin}/${pathname}`;
    }
    const head = `${prefix}/`;
    if (!pathname.startsWith(head)) throw bad();
    const parts = pathname.slice(head.length).split('/');
    const [folderPart, name] = parts;
    if (parts.length !== 2 || folderPart === undefined || !isStoredName(name)) throw bad();
    const folder = checkFolder(folderPart, folders);
    return { target: url ?? pathname, folder, name, pathname, ...(url ? { url } : {}) };
  }

  function stored(
    folder: string,
    blob: { url: string; pathname: string; size?: number; contentType?: string; uploadedAt?: Date },
  ): StoredFile {
    const name = blob.pathname.slice(blob.pathname.lastIndexOf('/') + 1);
    const contentType = blob.contentType ?? fileTypeOf(name)?.contentType;
    return {
      store: 'blob',
      folder,
      name,
      pathname: blob.pathname,
      src: blob.url,
      downloadHref: downloadHrefOf(blob.url),
      ...(blob.size !== undefined ? { size: blob.size } : {}),
      ...(contentType ? { contentType } : {}),
      ...(blob.uploadedAt instanceof Date ? { uploadedAt: blob.uploadedAt.toISOString() } : {}),
    };
  }

  async function putOne(file: PreparedFile): Promise<StoredFile> {
    let result: PutBlobResult;
    try {
      result = await blobPut(`${prefix}/${file.folder}/${file.name}`, toBuffer(file.bytes), {
        ...BLOB_WRITE_OPTIONS,
        contentType: file.type.contentType,
        multipart: file.bytes.byteLength > MULTIPART_FROM,
        token,
      });
    } catch (error) {
      throw failure(error);
    }
    return stored(file.folder, {
      url: result.url,
      pathname: result.pathname,
      size: file.bytes.byteLength,
      contentType: file.type.contentType,
    });
  }

  async function putMany(files: readonly PutInput[], putOptions: PutOptions = {}): Promise<StoredFile[]> {
    const prepared = await prepareAll(files, 'blob', folders, putOptions.inspect);
    const out: StoredFile[] = [];
    for (const file of prepared) out.push(await putOne(file));
    return out;
  }

  return {
    store: 'blob',
    target: 'blob',

    async put(file, putOptions) {
      const [one] = await putMany([file], putOptions);
      if (!one) throw new StorageError('invalid-size', M.invalidSize, 400);
      return one;
    },

    putMany,

    async delete(src) {
      const targets = [...new Set(asList(src).map((value) => parse(value).target))];
      if (targets.length === 0) return;
      try {
        await blobDelete(targets.length === 1 ? targets[0] : targets, { token });
      } catch (error) {
        throw failure(error);
      }
    },

    async list(folder) {
      const checked = checkFolder(folder, folders);
      const base = `${prefix}/${checked}/`;
      const files: StoredFile[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        let result: ListBlobResult;
        try {
          result = await blobList({ prefix: base, limit: LIST_PAGE, token, ...(cursor ? { cursor } : {}) });
        } catch (error) {
          throw failure(error);
        }
        for (const blob of result.blobs) {
          const name = blob.pathname.slice(base.length);
          if (!blob.pathname.startsWith(base) || name.includes('/') || !isStoredName(name)) continue;
          files.push(stored(checked, blob));
        }
        if (!result.hasMore || !result.cursor) break;
        cursor = result.cursor;
      }
      return files.sort(byName);
    },

    url(file) {
      const address = parse(file.src);
      if (!address.url || address.folder !== file.folder || address.name !== file.name) {
        throw new StorageError('bad-path', M.blobBadAddress(String(file.src)), 400);
      }
      return address.url;
    },
  };
}
