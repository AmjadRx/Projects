/**
 * A small PNG reader for the screenshots Chrome takes (8 bits a channel, RGB or RGBA, not
 * interlaced), so the contrast checks (./contrast.ts) can read pixels without a package: the
 * chunks, zlib's inflate from Node, and the five row filters of the PNG specification.
 */
import zlib from 'node:zlib';

/** An image as RGBA bytes, row by row from the top left. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG file. Throws on a kind Chrome does not write (palette, 16 bits, interlaced). */
export function decodePng(file: Buffer): Raster {
  if (file.length < SIGNATURE.length || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`a PNG this reader does not handle (depth ${depth}, color type ${colorType}, interlace ${interlace})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(parts));
  if (raw.length < height * (stride + 1)) throw new Error('a PNG with too little image data');
  const out = new Uint8Array(width * height * 4);
  // The row above starts as zeros. A Uint8Array keeps each sum modulo 256, as the filters need.
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const x = raw.subarray(start + 1, start + 1 + stride);
    // One loop a filter, the first pixel apart (it has nothing to its left).
    switch (filter) {
      case 0:
        current.set(x);
        break;
      case 1:
        for (let i = 0; i < channels; i += 1) current[i] = x[i];
        for (let i = channels; i < stride; i += 1) current[i] = x[i] + current[i - channels];
        break;
      case 2:
        for (let i = 0; i < stride; i += 1) current[i] = x[i] + previous[i];
        break;
      case 3:
        for (let i = 0; i < channels; i += 1) current[i] = x[i] + (previous[i] >> 1);
        for (let i = channels; i < stride; i += 1) current[i] = x[i] + ((current[i - channels] + previous[i]) >> 1);
        break;
      case 4:
        for (let i = 0; i < channels; i += 1) current[i] = x[i] + previous[i];
        for (let i = channels; i < stride; i += 1) {
          const a = current[i - channels];
          const b = previous[i];
          const c = previous[i - channels];
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          current[i] = x[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        break;
      default:
        throw new Error(`a PNG row with an unknown filter (${filter})`);
    }
    const row = y * width * 4;
    if (channels === 4) out.set(current, row);
    else {
      for (let px = 0, i = 0, o = row; px < width; px += 1, i += 3, o += 4) {
        out[o] = current[i];
        out[o + 1] = current[i + 1];
        out[o + 2] = current[i + 2];
        out[o + 3] = 255;
      }
    }
    [previous, current] = [current, previous];
  }
  return { width, height, data: out };
}
