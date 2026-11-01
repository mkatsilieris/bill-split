// Generates PWA PNG icons (no native deps) matching public/icon.svg.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BG = [0x1d, 0x4e, 0xd8];
const FG = [0xff, 0xff, 0xff];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function render(size, padding) {
  const s = size;
  const scale = (s - 2 * padding) / 512; // SVG viewBox is 512
  const raw = Buffer.alloc((s * 4 + 1) * s);
  const radius = 112 * scale;
  const inside = (x, y, r) => Math.hypot(x, y) <= r;
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0; // filter none
    for (let x = 0; x < s; x++) {
      const px = (x + 0.5 - padding) / scale;
      const py = (y + 0.5 - padding) / scale;
      let color = null;
      // rounded square
      const inSquare =
        px >= 0 && py >= 0 && px <= 512 && py <= 512 &&
        !(
          (px < 112 && py < 112 && !inside(px - 112, py - 112, 112)) ||
          (px > 400 && py < 112 && !inside(px - 400, py - 112, 112)) ||
          (px < 112 && py > 400 && !inside(px - 112, py - 400, 112)) ||
          (px > 400 && py > 400 && !inside(px - 400, py - 400, 112))
        );
      if (inSquare || padding > 0) color = BG; // maskable icons: fill the padding too
      if (inSquare) {
        const d = Math.hypot(px - 256, py - 256);
        if (Math.abs(d - 150) <= 20) color = FG; // ring
        if (Math.abs(px - 256) <= 20 && py >= 86 && py <= 426) color = FG; // bar
        if (inside(px - 186, py - 256, 30) || inside(px - 326, py - 256, 30)) color = FG; // dots
      }
      const o = y * (s * 4 + 1) + 1 + x * 4;
      if (color) {
        raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2]; raw[o + 3] = 255;
      } else {
        raw[o + 3] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, 'icon-192.png'), render(192, 0));
writeFileSync(join(out, 'icon-512.png'), render(512, 0));
writeFileSync(join(out, 'apple-touch-icon.png'), render(180, 0));
console.log('icons written to', out);
