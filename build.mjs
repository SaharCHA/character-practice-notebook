// Збирає дані для «Зошита ієрогліфів»: site/hanzi-writer.min.js та site/d/<номер>.json
// Запуск: npm i && node build.mjs
import { readFile, writeFile, mkdir, copyFile, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = join(ROOT, 'site');
const OUT = join(SITE, 'd');
const DATA = join(ROOT, 'node_modules', 'hanzi-writer-data');
const DICT_URL = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt';
const DICT_CACHE = join(ROOT, 'dictionary.txt');
const BUCKET = 96;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadDictionary() {
  if (!(await exists(DICT_CACHE))) {
    console.log('Завантажую dictionary.txt…');
    const res = await fetch(DICT_URL);
    if (!res.ok) throw new Error(`dictionary.txt: HTTP ${res.status}`);
    await writeFile(DICT_CACHE, await res.text());
  }
  const text = await readFile(DICT_CACHE, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function etymology(e) {
  if (!e) return undefined;
  const out = {};
  if (e.type) out.t = e.type;
  if (e.hint) out.h = e.hint;
  if (e.phonetic) out.p = e.phonetic;
  if (e.semantic) out.s = e.semantic;
  return Object.keys(out).length ? out : undefined;
}

async function main() {
  await mkdir(SITE, { recursive: true });
  await copyFile(
    join(ROOT, 'node_modules', 'hanzi-writer', 'dist', 'hanzi-writer.min.js'),
    join(SITE, 'hanzi-writer.min.js'),
  );

  const dict = await loadDictionary();
  const buckets = new Map();
  let count = 0;
  let skipped = 0;

  for (const entry of dict) {
    const ch = entry.character;
    let strokes;
    try {
      strokes = JSON.parse(await readFile(join(DATA, `${ch}.json`), 'utf8'));
    } catch {
      skipped++;
      continue;
    }
    const rec = { s: strokes.strokes, m: strokes.medians };
    const rad = strokes.radStrokes;
    if (rad && rad.length && rad.length < strokes.strokes.length) rec.r = rad;
    rec.p = entry.pinyin || [];
    if (entry.definition) rec.d = entry.definition;
    if (entry.decomposition && entry.decomposition !== '？') rec.x = entry.decomposition;
    if (entry.radical) rec.k = entry.radical;
    const e = etymology(entry.etymology);
    if (e) rec.e = e;

    const n = Math.floor(ch.codePointAt(0) / BUCKET);
    if (!buckets.has(n)) buckets.set(n, {});
    buckets.get(n)[ch] = rec;
    count++;
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  let bytes = 0;
  for (const [n, chars] of buckets) {
    const json = JSON.stringify(chars);
    bytes += Buffer.byteLength(json);
    await writeFile(join(OUT, `${n}.json`), json);
  }
  console.log(`Файлів: ${buckets.size}, знаків: ${count}, пропущено: ${skipped}, обсяг: ${(bytes / 1048576).toFixed(1)} МБ`);
}

main().catch((err) => { console.error(err); process.exit(1); });
