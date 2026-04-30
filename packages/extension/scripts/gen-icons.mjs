// Generate solid-color square PNG icons (16/48/128) with no external deps.
//
// Hand-rolls a minimal valid PNG:
//   PNG signature + IHDR + IDAT (zlib-compressed raw scanlines) + IEND.
//
// Used at build time by esbuild.config.mjs if icons are missing in public/icons.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 table (RFC 2083 / zlib spec).
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

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Build a solid-color RGBA PNG of the given size.
 * @param {number} size  width=height in pixels
 * @param {[number,number,number,number]} rgba 0-255 channel values
 */
function makeSolidPng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Raw image data: each scanline starts with filter byte (0 = none),
  // then size * 4 RGBA bytes.
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const px = off + 1 + x * 4;
      raw[px] = rgba[0];
      raw[px + 1] = rgba[1];
      raw[px + 2] = rgba[2];
      raw[px + 3] = rgba[3];
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function generateIcons(outDir) {
  // Conduit indigo-ish placeholder.
  const rgba = [99, 102, 241, 255];
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const png = makeSolidPng(size, rgba);
    await writeFile(path.join(outDir, `icon-${size}.png`), png);
  }
}

// Allow running this script directly: `node scripts/gen-icons.mjs <outDir>`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? path.resolve(process.cwd(), "public/icons");
  await generateIcons(outDir);
  // eslint-disable-next-line no-console
  console.log("Wrote 16/48/128 icons to", outDir);
}
