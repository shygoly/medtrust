#!/usr/bin/env node
/**
 * Split data/synthea/ingested into per-hospital connector bundles.
 * Output: data/synthea/connectors/{demohospa,demohospb}/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data/synthea/ingested');
const outRoot = path.join(root, 'data/synthea/connectors');

const buckets = {
  demohospa: path.join(outRoot, 'demohospa'),
  demohospb: path.join(outRoot, 'demohospb'),
};

if (!fs.existsSync(src)) {
  console.error('Missing', src);
  process.exit(1);
}

for (const dir of Object.values(buckets)) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const files = fs.readdirSync(src).filter((f) => f.startsWith('patient-') && f.endsWith('.json')).sort();
const mid = Math.ceil(files.length / 2);

for (let i = 0; i < files.length; i++) {
  const name = files[i];
  const bucket = i < mid ? 'demohospa' : 'demohospb';
  fs.copyFileSync(path.join(src, name), path.join(buckets[bucket], name));
}

console.log(
  JSON.stringify({
    total: files.length,
    demohospa: fs.readdirSync(buckets.demohospa).length,
    demohospb: fs.readdirSync(buckets.demohospb).length,
  }),
);
