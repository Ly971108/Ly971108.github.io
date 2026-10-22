// build-content.mjs — 内容唯一事实源 content/*.md → 静态页 + index.html template 注入
// 用法: node content/build-content.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => { mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); writeFileSync(path.join(ROOT, p), s); };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- markdown ----------
function parseMd(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

function mdToHtml(md) {
  marked.use({ gfm: true, breaks: false });
  return marked.parse(md);
}

// ---------- site ----------
const site = JSON.parse(read('content/site.json'));

// ---------- posts ----------
const postsDir = path.join(ROOT, 'content/posts');
const posts = [];
for (const f of readdirSync(postsDir).filter(f => f.endsWith('.md')).sort()) {
  const { meta, body } = parseMd(read('content/posts/' + f));
  if (!meta.title || !meta.date) { console.warn('skip (no title/date):', f); continue; }
  const slug = f.replace(/\.md$/, '');
  const html = mdToHtml(body);
  const url = `posts/${slug}/`;
  posts.push({ slug, title: meta.title, date: meta.date, description: meta.description || '', url, html });
}
posts.sort((a, b) => b.date.localeCompare(a.date));

// 文章静态页
for (const p of posts) {
  const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(p.title)} · ${esc(site.name)}</title>
<meta name="description" content="${esc(p.description || site.description)}">
<link rel="canonical" href="${url2(ROOT, p.url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:site_name" content="${esc(site.name)}">
<link rel="stylesheet" href="../../assets/theme/flat.css">
<link rel="stylesheet" href="../../assets/theme/posts.css">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: p.title, datePublished: p.date, description: p.description, author: { '@type': 'Person', name: site.author } }, null, 2)}
</script>
</head>
<body class="post-template" data-index="post">
<header class="site">
  <a class="name" href="../../">${esc(site.name)}</a>
  <nav aria-label="站点"><a href="../../">首页</a><a href="../../about/">关于</a><a href="../../#posts">写作</a><a href="../../#online">联系</a></nav>
</header>
<main class="pb-grid">
  <article class="post">
    <h1>${esc(p.title)}</h1>
    <p class="meta"><time datetime="${p.date}">${p.date}</time></p>
    ${p.html}
  </article>
  <nav class="postnav" aria-label="更多文章"><a href="../../#posts">← 全部文章</a></nav>
</main>
<footer class="pfoot"><a href="../../">回到老屋</a></footer>
</body>
</html>
`;
  write(p.url + 'index.html', page);
}
function url2(root, rel) { return rel; } // 相对路径，user/project site 均可

// about 静态页
const aboutMd = read('content/about.md');
const aboutHtml = mdToHtml(aboutMd);
write('about/index.html', `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>关于 · ${esc(site.name)}</title>
<meta name="description" content="${esc(site.description)}">
<link rel="stylesheet" href="../assets/theme/flat.css">
<link rel="stylesheet" href="../assets/theme/posts.css">
</head>
<body class="about-template" data-index="about">
<header class="site">
  <a class="name" href="../">${esc(site.name)}</a>
  <nav aria-label="站点"><a href="../">首页</a><a href="../#posts">写作</a><a href="../#online">联系</a></nav>
</header>
<main class="pb-grid"><article class="post about">${aboutHtml}</article></main>
<footer class="pfoot"><a href="../">回到老屋</a></footer>
</body>
</html>
`);

// ---------- index.html template 注入 ----------
let idx = read('index.html');

const postsTpl = posts.map(p =>
  `<li data-y="${p.date.slice(0, 4)}"><a href="${p.url}" data-date="${fmtDate(p.date)}"><span class="t">${esc(p.title)}</span><span class="d">${fmtDateShort(p.date)}</span></a></li>`
).join('\n');
inject('RM:posts', postsTpl);

inject('RM:about', aboutHtml);

// 静态回退区的文章列表（与 template 同数据，供 noscript / 降级版）
const staticPosts = posts.map(p =>
  `<li data-y="${p.date.slice(0, 4)}"><a href="${p.url}" data-date="${fmtDate(p.date)}"><span class="t">${esc(p.title)}</span><span class="d">${fmtDateShort(p.date)}<span class="dy"> ${p.date.slice(0, 4)}</span></span></a></li>`
).join('\n');
inject('RM:static-posts', staticPosts);

// 社交链接
const socialRows = site.social.filter(s => s.url).map(s =>
  `<div class="pb-item"><div class="pb-hd"><a class="t" href="${esc(s.url)}">${esc(s.label)}</a><span class="y">${esc(s.handle)}</span></div></div>`
).join('\n');
inject('RM:online', socialRows);

write('index.html', idx);
console.log(`build ok: ${posts.length} posts, about, online injected.`);

function inject(marker, content) {
  const open = `<!-- ${marker} -->`, close = `<!-- /${marker} -->`;
  if (!idx.includes(open) || !idx.includes(close)) throw new Error('marker missing: ' + marker);
  idx = idx.replace(new RegExp(escapeRe(open) + '[\\s\\S]*?' + escapeRe(close)), open + '\n' + content + '\n' + close);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
}
