// build-rss.mjs — 生成 rss.xml
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');
const site = JSON.parse(read('content/site.json'));

function parseMd(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m ? m[2] : raw };
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const posts = [];
for (const f of readdirSync(path.join(ROOT, 'content/posts')).filter(f => f.endsWith('.md'))) {
  const { meta } = parseMd(read('content/posts/' + f));
  if (meta.title && meta.date) posts.push({ ...meta, slug: f.replace(/\.md$/, '') });
}
posts.sort((a, b) => b.date.localeCompare(a.date));

const items = posts.map(p => `  <item>
    <title>${esc(p.title)}</title>
    <link>posts/${p.slug}/</link>
    <guid>posts/${p.slug}/</guid>
    <pubDate>${new Date(p.date + 'T00:00:00Z').toUTCString()}</pubDate>
    <description>${esc(p.description || '')}</description>
  </item>`).join('\n');

writeFileSync(path.join(ROOT, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(site.name)}</title>
  <description>${esc(site.description)}</description>
  <link>./</link>
${items}
</channel>
</rss>
`);
console.log('rss ok:', posts.length, 'items');
