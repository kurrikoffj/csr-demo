// Draws the app icon (a marker inside its start circle, as a road-sign roundel) and writes PNGs.
// No dependencies: node tools/make-icons.mjs

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ASPHALT = [0x15, 0x17, 0x1a];
const WHITE = [0xf4, 0xf5, 0xf2];
const RED = [0xc4, 0x16, 0x1c];
const BLUE = [0x0f, 0x4c, 0x8a];

// Colour at a point, with the icon spanning -1..1.
function colourAt(x, y) {
  const r = Math.hypot(x, y);
  if (r < 0.16) return BLUE; // the marker
  if (r < 0.56) return WHITE;
  if (r < 0.76) return RED; // the circle it starts from
  return ASPHALT;
}

function png(size) {
  const SS = 4; // supersampling
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 3 + 1);
    raw[row] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt(((px + (sx + 0.5) / SS) / size) * 2 - 1, ((py + (sy + 0.5) / SS) / size) * 2 - 1);
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      for (let i = 0; i < 3; i++) raw[row + 1 + px * 3 + i] = Math.round(sum[i] / (SS * SS));
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`icons/icon-${size}.png`);
}
