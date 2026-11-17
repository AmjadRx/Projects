/** Types of the media storage adapter (lib/storage.ts). */
import type { FileType, StoreName } from './rules';

/** A file in a store, as `put` and `list` return it. */
export interface StoredFile {
  /** The backend that holds it. Content records this as `MediaRef.store`. */
  store: StoreName;
  /** "site" or a project slug. */
  folder: string;
  /** The name as stored. A Blob name carries the random suffix Blob added. */
  name: string;
  /** The key inside the store: `public/media/raven/a.webp`, or the Blob pathname `media/raven/a-x1y2.webp`. */
  pathname: string;
  /** The address content stores in `MediaRef.src`: `/media/raven/a.webp`, or the Blob URL. */
  src: string;
  /** The plain download link: the same address for repository files, Blob's download address for Blob files (D-27). */
  downloadHref: string;
  size?: number;
  contentType?: string;
  /** ISO date and time of the upload, when the store reports it (Blob does). */
  uploadedAt?: string;
}

/** Names a stored file for `url()`: a `StoredFile`, or its folder and name (and `src` for Blob). */
export interface StoredFileRef {
  folder: string;
  name: string;
  src?: string;
}

/** A file to store. `name` is the name it was uploaded with; the store cleans it. */
export interface PutInput {
  folder: string;
  name: string;
  bytes: Uint8Array;
}

/** What an `Inspector` receives: the file after the folder, name, type, and size checks. */
export interface InspectInput {
  folder: string;
  /** The cleaned name the store will use. */
  name: string;
  ext: string;
  type: FileType;
  store: StoreName;
  bytes: Uint8Array;
}

/**
 * The hook for the checks that need the file's bytes, which the Phase 6 upload route supplies
 * (docs/V3_PLAN.md D-24): detect the type from the bytes and throw when it does not match the
 * extension, sanitize an SVG file, re-encode a photo without its metadata. It returns the bytes to
 * store, or throws to refuse the file.
 *
 * The stores refuse an SVG file when no inspector is given, so an unsanitized SVG can never be
 * written. For other types the extension check here is the only check until the route adds one.
 * A file uploaded from the browser straight to Blob never passes through `put`: the route that
 * confirms such an upload runs the same checks and deletes a file that fails them (D-26).
 */
export type Inspector = (file: InspectInput) => Uint8Array | Promise<Uint8Array>;

export interface PutOptions {
  /**
   * Repository only: overwrite a file with the same name, when the owner chose Replace (D-25).
   * A Blob file is never overwritten: every Blob put makes a new object.
   */
  replace?: boolean;
  /** Repository only: the commit message. Commit messages are public. */
  message?: string;
  /** The byte checks of the upload route. See `Inspector`. */
  inspect?: Inspector;
}

export interface DeleteOptions {
  /** Repository only: the commit message. */
  message?: string;
}

/**
 * One interface over both backends (ARCHITECTURE.md 13A): `put`, `delete`, `list`, `url`.
 *
 * Deleting is immediate. The admin first lists the references to a file in `draft` and `main`
 * and asks before removing it (D-25); a Blob file waits until no branch refers to it (D-27).
 */
export interface MediaStorage {
  readonly store: StoreName;
  /** Where the bytes go: the GitHub API (the draft branch), the local disk (development), or Vercel Blob. */
  readonly target: 'github' | 'disk' | 'blob';
  put(file: PutInput, options?: PutOptions): Promise<StoredFile>;
  /** Several files at once: one commit for the repository through GitHub (R-19). */
  putMany(files: readonly PutInput[], options?: PutOptions): Promise<StoredFile[]>;
  /** Removes files by their stored address (`src`). A file that is not there is skipped. */
  delete(src: string | readonly string[], options?: DeleteOptions): Promise<void>;
  /** The files directly inside one folder, by name. */
  list(folder: string): Promise<StoredFile[]>;
  /** The address content stores for a file: `/media/<folder>/<name>`, or the stored Blob URL. */
  url(file: StoredFileRef): string;
}

export interface StorageOptions {
  /** The project slugs that exist. When given, a folder must be "site" or one of them (D-24). */
  knownFolders?: Iterable<string>;
}
