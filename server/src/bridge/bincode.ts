/**
 * Minimal bincode 2.0 (`config::standard()`) codec for the Herdr thin-client
 * wire protocol.
 *
 * Integer encoding is **varint**:
 *   value < 251   : 1 byte (the value)
 *   value <= u16  : 0xfb, then 2 bytes LE
 *   value <= u32  : 0xfc, then 4 bytes LE
 *   else          : 0xfd, then 8 bytes LE
 *
 * `u8` and `bool` are a single raw byte. `u16/u32/u64`, enum variant indices,
 * and string/vec lengths all use varint. Strings/vecs are length-prefixed.
 * Structs are fields in declaration order (no prefix). Options are a u8 tag
 * (0=None, 1=Some) followed by the value when Some.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class BinWriter {
  private chunks: Buffer[] = [];
  private len = 0;

  private push(b: Buffer) {
    this.chunks.push(b);
    this.len += b.length;
  }

  u8(v: number) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    this.push(b);
  }
  bool(v: boolean) {
    this.u8(v ? 1 : 0);
  }
  varint(v: number | bigint) {
    const n = typeof v === "bigint" ? v : BigInt(v);
    if (n < 251n) {
      this.u8(Number(n));
    } else if (n <= 0xffffn) {
      this.u8(251);
      const b = Buffer.alloc(2);
      b.writeUInt16LE(Number(n), 0);
      this.push(b);
    } else if (n <= 0xffffffffn) {
      this.u8(252);
      const b = Buffer.alloc(4);
      b.writeUInt32LE(Number(n), 0);
      this.push(b);
    } else {
      this.u8(253);
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(n, 0);
      this.push(b);
    }
  }
  string(s: string) {
    const bytes = textEncoder.encode(s);
    this.varint(bytes.length);
    this.push(Buffer.from(bytes));
  }
  bytes(data: Uint8Array) {
    this.varint(data.length);
    this.push(Buffer.from(data));
  }
  option<T>(v: T | null | undefined, write: (x: T) => void) {
    if (v === null || v === undefined) {
      this.u8(0);
    } else {
      this.u8(1);
      write(v);
    }
  }
  variant(index: number) {
    this.varint(index);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.len);
  }
}

export class BinReader {
  private off = 0;
  constructor(private buf: Buffer) {}

  private take(n: number): Buffer {
    if (this.off + n > this.buf.length) {
      throw new Error(`bincode: short read at ${this.off} need ${n}`);
    }
    const b = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return b;
  }

  u8(): number {
    return this.take(1).readUInt8(0);
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  varint(): number {
    const first = this.u8();
    if (first < 251) return first;
    if (first === 251) return this.take(2).readUInt16LE(0);
    if (first === 252) return this.take(4).readUInt32LE(0);
    if (first === 253) return Number(this.take(8).readBigUInt64LE(0));
    throw new Error(`bincode: invalid varint marker ${first}`);
  }
  /** Lossless IDs/fingerprints; unlike sizes these may use the full u64 range. */
  varintBigInt(): bigint {
    const first = this.u8();
    if (first < 251) return BigInt(first);
    if (first === 251) return BigInt(this.take(2).readUInt16LE(0));
    if (first === 252) return BigInt(this.take(4).readUInt32LE(0));
    if (first === 253) return this.take(8).readBigUInt64LE(0);
    throw new Error(`bincode: invalid varint marker ${first}`);
  }
  string(): string {
    const n = this.varint();
    return textDecoder.decode(this.take(n));
  }
  bytes(): Buffer {
    const n = this.varint();
    return Buffer.from(this.take(n));
  }
  option<T>(read: () => T): T | null {
    return this.u8() === 1 ? read() : null;
  }
  variant(): number {
    return this.varint();
  }

  get remaining(): number {
    return this.buf.length - this.off;
  }
}

/** Length-prefixed frame: u32 LE payload-length + payload. */
export function encodeFrame(payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32LE(payload.length, 0);
  return Buffer.concat([head, payload], 4 + payload.length);
}
