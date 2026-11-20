/**
 * The OpenType container (an "sfnt"): a table directory followed by the tables. A font here is its
 * flavor (TrueType outlines are 0x00010000) and its tables by tag; `writeSfnt` lays them out with
 * checksums, four-byte alignment, and the head table's whole-font checksum adjustment.
 */
import { Reader, Writer } from './binary';

export const TRUETYPE = 0x00010000;

export interface Font {
  flavor: number;
  tables: Map<string, Uint8Array>;
}

export function readSfnt(data: Uint8Array): Font {
  const r = new Reader(data);
  const flavor = r.u32();
  const numTables = r.u16();
  r.pos += 6;
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i += 1) {
    const tag = r.tag();
    r.u32();
    const offset = r.u32();
    const length = r.u32();
    tables.set(tag, data.subarray(offset, offset + length));
  }
  return { flavor, tables };
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(data.byteLength / 4) * 4);
  padded.set(data);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.byteLength; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

export function writeSfnt(font: Font): Uint8Array {
  const tags = [...font.tables.keys()].sort();
  const numTables = tags.length;
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const w = new Writer();
  w.u32(font.flavor).u16(numTables).u16(searchRange).u16(entrySelector).u16(numTables * 16 - searchRange);
  let offset = 12 + numTables * 16;
  const placed: { tag: string; data: Uint8Array; offset: number }[] = [];
  for (const tag of tags) {
    let data = font.tables.get(tag)!;
    if (tag === 'head') {
      // The whole-font adjustment is computed with this field at zero, then written in.
      data = data.slice();
      new DataView(data.buffer).setUint32(8, 0);
    }
    w.tag(tag).u32(checksum(data)).u32(offset).u32(data.byteLength);
    placed.push({ tag, data, offset });
    offset += Math.ceil(data.byteLength / 4) * 4;
  }
  for (const table of placed) w.bytes(table.data).pad(4);
  const out = w.toBytes();
  const head = placed.find((t) => t.tag === 'head');
  if (head) new DataView(out.buffer).setUint32(head.offset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
