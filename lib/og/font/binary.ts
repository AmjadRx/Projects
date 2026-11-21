/**
 * Big-endian reading and writing over byte arrays, for the font tables (OpenType stores every
 * number big-endian). A read past the end throws a RangeError, so a damaged file fails loudly.
 */

export class Reader {
  readonly data: Uint8Array;
  readonly view: DataView;
  pos: number;

  constructor(data: Uint8Array, pos = 0) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.data.byteLength;
  }

  u8(): number {
    const value = this.view.getUint8(this.pos);
    this.pos += 1;
    return value;
  }

  i8(): number {
    const value = this.view.getInt8(this.pos);
    this.pos += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.pos);
    this.pos += 2;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.pos);
    this.pos += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.pos);
    this.pos += 4;
    return value;
  }

  i32(): number {
    const value = this.view.getInt32(this.pos);
    this.pos += 4;
    return value;
  }

  /** A 2.14 fixed-point number (variation coordinates). */
  f2dot14(): number {
    return this.i16() / 16384;
  }

  /** A 16.16 fixed-point number (fvar axis values). */
  fixed(): number {
    return this.i32() / 65536;
  }

  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }

  bytes(count: number): Uint8Array {
    if (count < 0 || this.pos + count > this.data.byteLength) throw new RangeError('Read past the end of the data');
    const out = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }

  /** A reader over the next `count` bytes, which this reader then skips. */
  sub(count: number): Reader {
    return new Reader(this.bytes(count));
  }
}

/** A growable big-endian byte buffer. */
export class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private reserve(extra: number): void {
    if (this.length + extra <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number): this {
    this.reserve(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
    return this;
  }

  i8(value: number): this {
    this.reserve(1);
    this.view.setInt8(this.length, value);
    this.length += 1;
    return this;
  }

  u16(value: number): this {
    this.reserve(2);
    this.view.setUint16(this.length, value);
    this.length += 2;
    return this;
  }

  i16(value: number): this {
    this.reserve(2);
    this.view.setInt16(this.length, value);
    this.length += 2;
    return this;
  }

  u32(value: number): this {
    this.reserve(4);
    this.view.setUint32(this.length, value >>> 0);
    this.length += 4;
    return this;
  }

  i32(value: number): this {
    this.reserve(4);
    this.view.setInt32(this.length, value);
    this.length += 4;
    return this;
  }

  tag(value: string): this {
    for (let i = 0; i < 4; i += 1) this.u8(value.charCodeAt(i) & 0xff);
    return this;
  }

  bytes(data: Uint8Array): this {
    this.reserve(data.byteLength);
    this.buf.set(data, this.length);
    this.length += data.byteLength;
    return this;
  }

  /** Zero bytes up to the next multiple of `align`. */
  pad(align: number): this {
    while (this.length % align !== 0) this.u8(0);
    return this;
  }

  /** Overwrites a 32-bit value already written. */
  setU32(at: number, value: number): void {
    this.view.setUint32(at, value >>> 0);
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
