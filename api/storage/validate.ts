import { IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION } from "../../contracts/media";
import type { ImageMime } from "../../contracts/media";
import { mediaKeySchema } from "../../contracts/game";

/**
 * Dependency-free image validation (plan §8.2). A signature check alone is
 * trivially spoofable, so each format is validated structurally:
 *   - PNG:  signature + first chunk must be a 13-byte IHDR with a correct
 *           CRC32, sane dimensions, and a well-formed IEND as the last chunk.
 *   - JPEG: SOI + segment walk with bounds-checked lengths until a SOF0-15
 *           marker yields dimensions; SOS/EOI before SOF is rejected.
 *   - WebP: RIFF/WEBP container with consistent sizes; dimensions are parsed
 *           from the VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk.
 * SVG (text), executables and anything else fail the allow-list sniff.
 */

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

export type MediaValidationReason = "too_large" | "unsupported" | "dimensions";

export class MediaValidationError extends Error {
  readonly reason: MediaValidationReason;
  constructor(reason: MediaValidationReason, message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.reason = reason;
  }
}

/* ------------------------------ byte helpers ------------------------------ */

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u24le = (b: Uint8Array, o: number) =>
  b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

/* --------------------------------- CRC32 ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ----------------------------------- PNG ---------------------------------- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// CRC32 of the literal "IEND" chunk payload — a fixed constant.
const PNG_IEND_CRC = 0xae426082;

function parsePng(b: Uint8Array): ImageInfo | null {
  // 8 sig + 4 len + 4 type + 13 data + 4 crc (IHDR) + 12 (IEND).
  if (b.length < 8 + 25 + 12) return null;
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIGNATURE[i]) return null;
  // The first chunk must be a 13-byte IHDR.
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (width < 1 || height < 1) return null;
  // IHDR integrity: CRC over "IHDR" + 13 data bytes. A spoofed header with
  // random junk after the signature fails here.
  if (crc32(b.subarray(12, 29)) !== u32be(b, 29)) return null;
  // The file must end with a well-formed IEND chunk (catches truncation).
  const tail = b.length - 12;
  if (u32be(b, tail) !== 0 || ascii(b, tail + 4, 4) !== "IEND") return null;
  if (u32be(b, tail + 8) !== PNG_IEND_CRC) return null;
  return { mime: "image/png", width, height };
}

/* ---------------------------------- JPEG ---------------------------------- */

// SOF markers: C0-CF except C4 (DHT), C8 (JPG extension), CC (DAC).
function isSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function parseJpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) return null;
    let marker = b[off + 1];
    // Skip 0xFF fill bytes before the real marker.
    while (marker === 0xff) {
      off += 1;
      if (off + 1 >= b.length) return null;
      marker = b[off + 1];
    }
    // Standalone markers without a length field.
    if (marker === 0xd8) {
      off += 2;
      continue;
    }
    if (marker === 0xd9) return null; // EOI before any SOF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const segLen = u16be(b, off + 2);
    if (segLen < 2 || off + 2 + segLen > b.length) return null;
    if (isSofMarker(marker)) {
      if (segLen < 7) return null;
      const height = u16be(b, off + 5);
      const width = u16be(b, off + 7);
      if (width < 1 || height < 1) return null;
      return { mime: "image/jpeg", width, height };
    }
    if (marker === 0xda) return null; // SOS before SOF: no frame header
    off += 2 + segLen;
  }
  return null;
}

/* ---------------------------------- WebP ---------------------------------- */

function parseWebp(b: Uint8Array): ImageInfo | null {
  if (b.length < 20) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const riffSize = u32le(b, 4);
  // RIFF size counts everything after its own 8-byte header.
  if (riffSize < 4 || riffSize + 8 > b.length) return null;
  const fourcc = ascii(b, 12, 4);
  const chunkSize = u32le(b, 16);
  const data = 20;
  if (fourcc === "VP8X") {
    // Extended container: 24-bit canvas size minus one.
    if (chunkSize < 10 || b.length < data + 10) return null;
    const width = u24le(b, data + 4) + 1;
    const height = u24le(b, data + 7) + 1;
    return { mime: "image/webp", width, height };
  }
  if (fourcc === "VP8 ") {
    // Lossy bitstream: 3-byte frame tag, then the 9D 01 2A start code,
    // then 14-bit width/height.
    if (chunkSize < 10 || b.length < data + 10) return null;
    if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) {
      return null;
    }
    const width = u16le(b, data + 6) & 0x3fff;
    const height = u16le(b, data + 8) & 0x3fff;
    if (width < 1 || height < 1) return null;
    return { mime: "image/webp", width, height };
  }
  if (fourcc === "VP8L") {
    // Lossless bitstream: 0x2F signature, then a 28-bit packed size field.
    if (chunkSize < 5 || b.length < data + 5) return null;
    if (b[data] !== 0x2f) return null;
    const packed = u32le(b, data + 1);
    const width = (packed & 0x3fff) + 1;
    const height = ((packed >> 14) & 0x3fff) + 1;
    return { mime: "image/webp", width, height };
  }
  return null;
}

/* --------------------------------- public --------------------------------- */

/** Sniffs the real format from the bytes; null when not PNG/JPEG/WebP. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

/**
 * Full upload validation: size cap, structural sniff, dimension cap.
 * Throws MediaValidationError; never returns null.
 */
export function validateImageBytes(bytes: Uint8Array): ImageInfo {
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new MediaValidationError(
      "too_large",
      `Image exceeds the ${IMAGE_MAX_BYTES}-byte limit`,
    );
  }
  const info = sniffImage(bytes);
  if (!info) {
    throw new MediaValidationError(
      "unsupported",
      "Only PNG, JPEG and WebP images are accepted",
    );
  }
  if (
    info.width > IMAGE_MAX_DIMENSION ||
    info.height > IMAGE_MAX_DIMENSION
  ) {
    throw new MediaValidationError(
      "dimensions",
      `Image dimensions exceed ${IMAGE_MAX_DIMENSION}x${IMAGE_MAX_DIMENSION}`,
    );
  }
  return info;
}

/* ------------------------------- key handling ------------------------------ */

const EXT_BY_MIME: Record<ImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Server-generated storage key: random UUID, no user-controlled path segment.
 * Validated against the shared strict mediaKeySchema before use.
 */
export function generateImageKey(mime: ImageMime): string {
  const key = `images/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
  assertValidStorageKey(key);
  return key;
}

/** Throws when a key fails the strict contract (path traversal guard). */
export function assertValidStorageKey(key: string): void {
  const parsed = mediaKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new MediaValidationError("unsupported", "Invalid storage key");
  }
}
