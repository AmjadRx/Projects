/**
 * Reads the names of the entries in a zip archive from its central directory, without unpacking
 * anything. Word, Excel, PowerPoint, OpenDocument, and 3MF files are zip archives; the entry names
 * tell them apart (and reveal macros) from the bytes, whatever the file is called.
 */

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
/** The end record is 22 bytes and may carry a comment of up to 65,535 bytes. */
export const ZIP_TAIL_BYTES = 22 + 65_535 + 20;
/** A larger central directory is not read (it would list hundreds of thousands of entries). */
const CENTRAL_DIRECTORY_MAX = 16 * 1024 * 1024;

export interface CentralDirectory {
  /** Byte offset of the central directory in the archive. */
  offset: number;
  size: number;
  entries: number;
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u64(bytes: Uint8Array, at: number): number {
  return u32(bytes, at) + u32(bytes, at + 4) * 2 ** 32;
}

/**
 * Finds the central directory from the archive's last bytes. `tail` holds the last bytes of the
 * file and `tailOffset` is where they start in it. Zip64 archives are read through their locator
 * when it lies in the tail. Returns null when the bytes are not the end of a zip archive.
 */
export function findCentralDirectory(tail: Uint8Array, tailOffset: number, fileSize: number): CentralDirectory | null {
  for (let at = tail.length - 22; at >= 0; at -= 1) {
    if (u32(tail, at) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(tail, at + 20);
    // The comment must reach the end of the file exactly, or this is a signature inside data.
    if (tailOffset + at + 22 + commentLength !== fileSize) continue;
    let entries = u16(tail, at + 10);
    let size = u32(tail, at + 12);
    let offset = u32(tail, at + 16);
    if (offset === 0xffffffff || size === 0xffffffff || entries === 0xffff) {
      const locator = at - 20;
      if (locator < 0 || u32(tail, locator) !== ZIP64_LOCATOR_SIGNATURE) return null;
      const record = u64(tail, locator + 8) - tailOffset;
      if (record < 0 || record + 56 > tail.length || u32(tail, record) !== ZIP64_EOCD_SIGNATURE) return null;
      entries = u64(tail, record + 32);
      size = u64(tail, record + 40);
      offset = u64(tail, record + 48);
    }
    if (offset + size > fileSize) return null;
    return { offset, size, entries };
  }
  return null;
}

/** The entry names in a central directory's bytes. */
export function parseCentralDirectory(bytes: Uint8Array): string[] {
  const names: string[] = [];
  const decoder = new TextDecoder('utf-8');
  let at = 0;
  while (at + 46 <= bytes.length && u32(bytes, at) === CENTRAL_SIGNATURE) {
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const end = at + 46 + nameLength;
    if (end > bytes.length) break;
    names.push(decoder.decode(bytes.subarray(at + 46, end)));
    at = end + extraLength + commentLength;
  }
  return names;
}

/** The entry names of a whole archive held in memory, or null when it is not a zip archive. */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  const tailOffset = Math.max(0, bytes.length - ZIP_TAIL_BYTES);
  const directory = findCentralDirectory(bytes.subarray(tailOffset), tailOffset, bytes.length);
  if (!directory) return null;
  return parseCentralDirectory(bytes.subarray(directory.offset, directory.offset + directory.size));
}

/** The entry names of a zip file, reading only its end and its central directory. */
export async function zipEntryNamesOf(file: Blob): Promise<string[] | null> {
  const tailOffset = Math.max(0, file.size - ZIP_TAIL_BYTES);
  const tail = new Uint8Array(await file.slice(tailOffset).arrayBuffer());
  const directory = findCentralDirectory(tail, tailOffset, file.size);
  if (!directory || directory.size > CENTRAL_DIRECTORY_MAX) return null;
  const bytes = new Uint8Array(await file.slice(directory.offset, directory.offset + directory.size).arrayBuffer());
  return parseCentralDirectory(bytes);
}
