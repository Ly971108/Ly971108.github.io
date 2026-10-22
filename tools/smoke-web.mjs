/* M2 smoke：JS 语法检查（node --check）+ CSS 花括号平衡。
 * 用法：node tools/smoke-web.mjs [sceneDir]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const dir = resolve(process.argv[2] || join(here, "..", "assets", "scene-js", "v0001"));
let bad = 0;

const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
for (const f of files.sort()) {
  const p = join(dir, f);
  if (/\.m?js$/i.test(f)) {
    // ES module 语法检查：stdin + --input-type=module
    const src = readFileSync(p, "utf8");
    const r = spawnSync(process.execPath, ["--check", "--input-type=module"], {
      input: src, encoding: "utf8"
    });
    if (r.status !== 0) { bad++; console.error("FAIL", f, "\n" + (r.stderr || "").trim()); }
    else console.log("ok  ", f);
  } else if (/\.css$/i.test(f)) {
    const src = readFileSync(p, "utf8");
    const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length;
    const noComment = src.replace(/\/\*[\s\S]*?\*\//g, "");
    const bad2 = (noComment.match(/\{/g) || []).length, badClose = (noComment.match(/\}/g) || []).length;
    if (open !== close || bad2 !== badClose) { bad++; console.error("FAIL", f, "braces", open, "vs", close); }
    else console.log("ok  ", f);
  } else {
    console.log("skip", f);
  }
}
console.log(bad ? `\n${bad} file(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
