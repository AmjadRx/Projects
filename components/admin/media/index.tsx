'use client';

/**
 * The admin's media components (ARCHITECTURE.md 7 and 13A; docs/V3_PLAN.md D-07, D-17, D-23 to
 * D-30). Every field sits inside a FileScope and changes content only through its `onChange`, so
 * the store records each change and Undo brings it back.
 *
 * - `MediaField`: one MediaRef (a cover, an image block, the hero media): Choose, Upload, Clear,
 *   alt text or a short description, caption, focal point, video captions, the poster.
 * - `MediaListField`: an ordered list of MediaRefs (a gallery, a log entry's photos).
 * - `FilePickField`: the address of any stored file (the `file` block).
 * - `MediaLibraryPanel`: one folder's library ("site" or a project's folder): drop many files,
 *   progress per file, both stores listed, rename, replace, delete, "not used anywhere".
 * - `OtherMediaFolders`: the folders no saved project names (a renamed or deleted project's
 *   files), each opening in its own library.
 *
 * Uploads run through one queue (./manager.ts): conversion in the browser (lib/admin/convert),
 * the content check over the file's words (/api/check), then the repository up to 4,000,000 bytes
 * or Vercel Blob above that. A field's upload goes to the field's place, followed through edits
 * (./targets.ts). The heavy converters and the Blob client load only when a file needs them, so
 * none of them is in the admin's first load.
 */
export { MediaField, type MediaFieldProps } from './MediaField';
export { MediaListField, type MediaListFieldProps } from './MediaListField';
export { FilePickField, type FilePickFieldProps } from './FilePickField';
export { MediaLibraryPanel, type MediaLibraryPanelProps } from './Library';
export { OtherMediaFolders, type OtherMediaFoldersProps } from './Folders';
