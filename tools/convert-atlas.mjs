// tools/convert-atlas.mjs — 烘焙 PNG → WebP（color q85 / 灯光图 q90）
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/scene/v0001/atlas');
let totalIn = 0, totalOut = 0;
for (const f of readdirSync(DIR).filter(f => f.endsWith('.png'))) {
  const q = f.includes('_color') ? 85 : 90;
  const out = f.replace(/\.png$/, '.webp');
  const info = await sharp(path.join(DIR, f)).webp({ quality: q }).toFile(path.join(DIR, out));
  totalIn += (await import('node:fs')).statSync(path.join(DIR, f)).size;
  totalOut += info.size;
  console.log(out, info.size, 'bytes');
}
console.log(`total: ${(totalIn / 1e6).toFixed(1)}MB -> ${(totalOut / 1e6).toFixed(1)}MB`);
