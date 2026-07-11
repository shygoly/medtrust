#!/usr/bin/env node
/**
 * Inline all local images as base64 data URIs → single self-contained HTML.
 * Usage: node docs/demo/inline-rws-flow-html.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'rws-federated-flow.html');
const OUT_HTML = path.join(ROOT, 'rws-federated-flow.standalone.html');
const IMG_RE = /src="(demo\/screenshots\/rws-flow\/[^"]+\.png)"/g;

let html = readFileSync(SRC_HTML, 'utf-8');
const seen = new Map();

html = html.replace(IMG_RE, (match, rel) => {
  if (!seen.has(rel)) {
    const abs = path.join(ROOT, rel);
    const b64 = readFileSync(abs).toString('base64');
    seen.set(rel, `data:image/png;base64,${b64}`);
  }
  return `src="${seen.get(rel)}"`;
});

const banner = `<!-- Self-contained build: ${new Date().toISOString()} · ${seen.size} images inlined -->\n`;
writeFileSync(OUT_HTML, banner + html);

const sizeMb = (Buffer.byteLength(banner + html) / 1024 / 1024).toFixed(2);
console.log(`✓ ${OUT_HTML}`);
console.log(`  ${seen.size} images inlined · ${sizeMb} MB`);
