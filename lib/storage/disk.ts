/**
 * The repository backend on the local disk: files under `<rootDir>/public/media/`, as v2 writes
 * them in local development when no GitHub variables are set. lib/storage.ts never picks it in
 * production, where the disk is read-only. Server only.
 *
 * It follows the same rules as the GitHub backend: cleaned names, the type allow-list, the
 * 4,000,000-byte line, no overwrite unless Replace was chosen, no two names that differ only in
 * letter case, and SVG only through an inspector that sanitizes it.
 */
import 'server-only';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_MESSAGES as M } from './labels';
import { checkFolder, checkStoredName, isStoredName, parseSitePath, REPO_MEDIA_DIR, sitePathOf, StorageError } from './rules';
import { asList, byName, prepareAll, storedRepoFile, toSet } from './shared';
import type { MediaStorage, PutInput, PutOptions, StorageOptions, StoredFile } from './types';

export interface DiskStorageOptions extends StorageOptions {
  /** The folder that holds `public/` (the repository root). */
  rootDir: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

export function createDiskStorage(options: DiskStorageOptions): MediaStorage {
  const mediaRoot = path.resolve(options.rootDir, ...REPO_MEDIA_DIR.split('/'));
  const folders = toSet(options.knownFolders);

  /** A path inside the media folder. The checked folder and name cannot leave it; this proves it. */
  function inside(folder: string, name?: string): string {
    const target = name === undefined ? path.join(mediaRoot, folder) : path.join(mediaRoot, folder, name);
    const relative = path.relative(mediaRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new StorageError('bad-path', M.badPath(name === undefined ? folder : `${folder}/${name}`), 400);
    }
    return target;
  }

  async function namesIn(folder: string): Promise<string[]> {
    try {
      return await fs.readdir(inside(folder));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw new StorageError('disk-failed', M.diskFailed, 500);
    }
  }

  async function putMany(files: readonly PutInput[], putOptions: PutOptions = {}): Promise<StoredFile[]> {
    const prepared = await prepareAll(files, 'repo', folders, putOptions.inspect);
    for (const folder of new Set(prepared.map((file) => file.folder))) {
      const existing = await namesIn(folder);
      for (const file of prepared) {
        if (file.folder !== folder) continue;
        if (existing.includes(file.name)) {
          if (!putOptions.replace) throw new StorageError('exists', M.exists(file.name), 409);
          continue;
        }
        const other = existing.find((name) => name.toLowerCase() === file.name.toLowerCase());
        if (other) throw new StorageError('exists', M.existsOtherCase(file.name, other), 409);
      }
    }
    for (const file of prepared) {
      try {
        await fs.mkdir(inside(file.folder), { recursive: true });
        await fs.writeFile(inside(file.folder, file.name), file.bytes, { flag: putOptions.replace ? 'w' : 'wx' });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') throw new StorageError('exists', M.exists(file.name), 409);
        throw new StorageError('disk-failed', M.diskFailed, 500);
      }
    }
    return prepared.map((file) => storedRepoFile(file.folder, file.name, file.bytes.byteLength));
  }

  return {
    store: 'repo',
    target: 'disk',

    async put(file, putOptions) {
      const [stored] = await putMany([file], putOptions);
      if (!stored) throw new StorageError('invalid-size', M.invalidSize, 400);
      return stored;
    },

    putMany,

    async delete(src) {
      const targets = asList(src).map((value) => parseSitePath(value, folders));
      for (const target of targets) {
        try {
          await fs.unlink(inside(target.folder, target.name));
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw new StorageError('disk-failed', M.diskFailed, 500);
        }
      }
    },

    async list(folder) {
      const checked = checkFolder(folder, folders);
      let entries: Dirent[];
      try {
        entries = await fs.readdir(inside(checked), { withFileTypes: true });
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return [];
        throw new StorageError('disk-failed', M.diskFailed, 500);
      }
      const files: StoredFile[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !isStoredName(entry.name)) continue;
        const stat = await fs.stat(inside(checked, entry.name));
        files.push(storedRepoFile(checked, entry.name, stat.size));
      }
      return files.sort(byName);
    },

    url(file) {
      return sitePathOf(checkFolder(file.folder, folders), checkStoredName(file.name));
    },
  };
}
