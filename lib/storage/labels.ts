/**
 * Words of the media storage adapter that the site's owner reads in the admin: refusals,
 * configuration problems, and the commit messages of media saves (public, since they stay in the
 * repository's history). They state no fact about the owner. They live here, beside the adapter,
 * because lib/strings.ts has no storage keys.
 *
 * Values from a request (a folder or a file name) are shortened before they are quoted.
 */
import { formatBytes } from '../media';

/** "4 MB (4,000,000 bytes)": the decimal size and the exact count, so a limit is never ambiguous. */
function size(bytes: number): string {
  return `${formatBytes(bytes)} (${bytes.toLocaleString('en-US')} bytes)`;
}

/** A value from a request, made safe to quote: printable characters only, at most 80 of them. */
function quoted(value: string): string {
  const clean = value.replace(/[^\x20-\x7e]/g, '?');
  return `"${clean.length > 80 ? `${clean.slice(0, 77)}...` : clean}"`;
}

export const STORAGE_MESSAGES = {
  invalidSize: 'The file size could not be read.',
  emptyFile: 'The file is empty.',
  tooLarge: (limit: number) => `This file is larger than ${size(limit)}, the most one file may be.`,
  tooLargeForRepo: (limit: number) =>
    `The repository holds files up to ${size(limit)}. A larger file goes to Vercel Blob.`,
  repoOnlyTooLarge: (ext: string, limit: number) =>
    `.${ext} files are kept in the repository only, so they must be ${size(limit)} or smaller.`,
  blobNotConfigured: (limit: number) =>
    `Files over ${size(limit)} are stored in Vercel Blob, which is not set up for this environment. ` +
    'To enable it, open the project in Vercel, go to Storage, choose Create Storage, then Blob, set the access ' +
    'to Public, and select "Add a read-write token env var to this connection", which sets BLOB_READ_WRITE_TOKEN. ' +
    'For a Blob store that already exists, add the token from its Projects tab with Update Project Connection. ' +
    'Then redeploy and upload the file again.',
  badFolder: (folder: string) =>
    `${quoted(folder)} is not a media folder. Use "site" or a project slug: lower-case letters and digits, joined by single hyphens.`,
  unknownFolder: (folder: string) => `No project has the slug ${quoted(folder)}.`,
  noExtension: 'The file name has no extension, so its type cannot be checked. Add the extension and try again.',
  refusedType: (ext: string) =>
    `${quoted(`.${ext}`)} files are refused in every store: web pages, XML, and scripts could run on the site.`,
  unsupportedType: (ext: string) =>
    `${quoted(`.${ext}`)} files are not accepted. Convert the file to an accepted type, or put it in a ZIP archive.`,
  repoOnlyType: (ext: string) => `.${ext} files are stored in the repository only, never in Vercel Blob.`,
  svgNotSanitized: 'An SVG file must be sanitized before it is stored.',
  inspectFailed: 'The check of the file did not return the bytes to store.',
  badPath: (value: string) => `${quoted(value)} is not a stored media file.`,
  exists: (name: string) =>
    `A file named ${quoted(name)} is already in this folder. Choose Replace to overwrite it, or rename the file.`,
  existsOtherCase: (name: string, other: string) =>
    `${quoted(other)} is already in this folder, and its name differs from ${quoted(name)} only in letter case. Rename the file.`,
  duplicateInBatch: (name: string) => `${quoted(name)} appears twice in this upload.`,
  repoNotConfigured:
    'Media cannot be saved: the server has no GitHub settings, and its disk is read-only. ' +
    'Set GITHUB_TOKEN, GITHUB_REPO, and GITHUB_DRAFT_BRANCH in the Vercel environment variables, then redeploy.',
  githubIncomplete: (missing: string) =>
    `GitHub storage needs both GITHUB_TOKEN and GITHUB_REPO, and ${missing} is not set. ` +
    'Set it, or remove both to save to the local disk in development.',
  badRepo: 'GITHUB_REPO must name one repository as owner/name.',
  noDraftBranch:
    'GITHUB_DRAFT_BRANCH is not set, so nothing can be written. Set it to the draft branch: there is no default branch.',
  protectedBranch: (branch: string) =>
    `GITHUB_DRAFT_BRANCH is ${quoted(branch)}, the production branch. Media is written only to a separate draft branch.`,
  badBranch: 'GITHUB_DRAFT_BRANCH is not a valid branch name.',
  draftMissing: (branch: string) =>
    `The branch ${quoted(branch)} does not exist in the repository. Create it from the production branch, then try again.`,
  conflict: 'The draft branch changed while this was being saved. Reload and try again.',
  githubFailed: (status: number, detail: string) =>
    `GitHub refused the request (${status}${detail ? `: ${detail}` : ''}).`,
  githubUnreachable: 'GitHub could not be reached. Try again in a moment.',
  githubUnexpected: 'GitHub sent a response this site does not understand.',
  diskFailed: 'The file could not be written to the local disk.',
  blobFailed: (detail: string) => `Vercel Blob refused the request${detail ? `: ${detail}` : '.'}`,
  blobBadAddress: (value: string) => `${quoted(value)} is not a media file in this Blob store.`,
  badPrefix: 'The Blob path prefix must be lower-case words joined by single slashes.',
} as const;

function summary(verb: string, paths: readonly string[]): string {
  if (paths.length === 1) return `media: ${verb} ${paths[0]}`;
  const shown = paths.slice(0, 5).join(', ');
  const rest = paths.length > 5 ? ` and ${paths.length - 5} more` : '';
  return `media: ${verb} ${paths.length} files (${shown}${rest})`;
}

/** Commit messages of the repository store. `paths` are "folder/name". */
export const COMMIT_MESSAGES = {
  save: (paths: readonly string[], replaced: number) =>
    summary(replaced === 0 ? 'add' : replaced === paths.length ? 'replace' : 'add and replace', paths),
  remove: (paths: readonly string[]) => summary('remove', paths),
} as const;
