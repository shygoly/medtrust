#!/usr/bin/env ts-node
/**
 * Pharma-side LoRA deliverable decrypt + verify CLI.
 *
 *   pnpm --filter @medtrust/api verify:lora -- ./lora-adapter-xxx.enc.json
 *   pnpm --filter @medtrust/api verify:lora -- ./bundle.enc.json --json
 *
 * Demo private key: env PHARMA_SM2_PRIVATE_KEY or built-in pharma-demo demo key.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GMCryptoService } from '../src/security/crypto/gm-crypto.service';
import { DEMO_CONSUMER_SM2_KEYS } from '../src/runtime/secretflow-orchestrator/demo-consumer-keys';
import type { LoraDeliverableRecord } from '../src/runtime/secretflow-orchestrator/lora-deliverable.service';
import { verifyLoraDeliverableBundle } from '../src/runtime/secretflow-orchestrator/lora-deliverable-verify';

function usage(): never {
  console.error(`Usage: verify-lora-deliverable <path-to.enc.json> [--json] [--expect LORA:…]

  Decrypts SM2/SM4 envelope with pharma SM2 private key and verifies loraDeltaHash.

  Env:
    PHARMA_SM2_PRIVATE_KEY  override demo private key (production)`);
  process.exit(2);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const jsonOut = args.includes('--json');
const fileArg = args.find((a) => !a.startsWith('--'));
const expectIdx = args.indexOf('--expect');
const expectedHash = expectIdx >= 0 ? args[expectIdx + 1] : undefined;

if (!fileArg) usage();

const path = resolve(fileArg);
let bundle: LoraDeliverableRecord;
try {
  bundle = JSON.parse(readFileSync(path, 'utf8')) as LoraDeliverableRecord;
} catch (err) {
  console.error(`Failed to read ${path}:`, err);
  process.exit(1);
}

const privateKey =
  process.env.PHARMA_SM2_PRIVATE_KEY ??
  DEMO_CONSUMER_SM2_KEYS[bundle.consumerId ?? 'pharma-demo']?.privateKey;

if (!privateKey) {
  console.error('No SM2 private key: set PHARMA_SM2_PRIVATE_KEY or use pharma-demo bundle');
  process.exit(1);
}

const report = verifyLoraDeliverableBundle(
  new GMCryptoService(),
  bundle,
  privateKey,
  expectedHash ?? bundle.loraDeltaHash,
);

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nLoRA deliverable verify — ${path}`);
  console.log(`taskId: ${report.taskId ?? '—'}`);
  console.log(`result: ${report.ok ? 'PASS ✓' : 'FAIL ✗'}\n`);
  for (const s of report.steps) {
    const mark = s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : '○';
    console.log(`  [${mark}] ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
  }
  if (report.computedLoraHash) {
    console.log(`\ncomputed: ${report.computedLoraHash}`);
  }
  if (report.adapterTensorKeys?.length) {
    console.log(`tensors:  ${report.adapterTensorKeys.join(', ')}`);
  }
  console.log('');
}

process.exit(report.ok ? 0 : 1);
