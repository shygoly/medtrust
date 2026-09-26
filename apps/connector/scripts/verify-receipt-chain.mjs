#!/usr/bin/env node
/**
 * 回执链**离线**校验（任务 8.7 / 规格「审计回执链」）。
 *
 *   node apps/connector/scripts/verify-receipt-chain.mjs --receipts receipts.json [--pubkey <hex>] [--node <urn>]
 *
 * receipts.json 形如：
 *   { "receipts": [ { "receipt_id": "...", "job_id": "...", "stage": "...", "event": "...",
 *                     "input_digests": [...], "op_digest": "...", "output_digest": "...",
 *                     "label": "C0", "prev_receipt_hash": null, "signer": "urn:...",
 *                     "at": "...", "sig": { "alg": "SM2-SM3", "kid": "...", "value": "..." } } ] }
 *
 * 校验两件事，都**不需要平台**：
 *   ① 逐节点链的连续性：每条 `prev_receipt_hash` 必须等于该节点上一条回执的 JCS+SM3 哈希；
 *   ② 给了 `--pubkey` 时，逐条验签（用签名方公钥）。
 * 断链或验签失败即退出码 1，并指出断在哪一条。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mdop = require('@medtrust/mdop');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const file = readFlag('--receipts');
const publicKey = readFlag('--pubkey');
const onlyNode = readFlag('--node');
if (!file) {
  console.error('用法：verify-receipt-chain.mjs --receipts <receipts.json> [--pubkey <hex>] [--node <urn>]');
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(file, 'utf8'));
const receipts = parsed.receipts ?? parsed;
if (!Array.isArray(receipts) || receipts.length === 0) {
  console.error('回执文件里没有任何回执');
  process.exit(1);
}

/** 按 signer 分组，保持文件里的顺序。 */
const byNode = new Map();
for (const receipt of receipts) {
  if (onlyNode && receipt.signer !== onlyNode) continue;
  const list = byNode.get(receipt.signer) ?? [];
  list.push(receipt);
  byNode.set(receipt.signer, list);
}

let failed = false;
for (const [node, list] of byNode) {
  const ordered = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let prev = null;
  let chainOk = true;
  let brokenAt;
  for (const [index, receipt] of ordered.entries()) {
    const declared = receipt.prev_receipt_hash ?? null;
    if (declared !== prev) {
      chainOk = false;
      brokenAt = `${index + 1}/${ordered.length} receipt_id=${receipt.receipt_id}（声明 prev=${declared ?? 'null'}，实际 ${prev ?? 'null'}）`;
      break;
    }
    if (publicKey) {
      const { sig, ...unsigned } = receipt;
      if (!mdop.verifyCanonicalObject(unsigned, sig, publicKey)) {
        chainOk = false;
        brokenAt = `${index + 1}/${ordered.length} receipt_id=${receipt.receipt_id}（签名验证失败）`;
        break;
      }
    }
    prev = mdop.canonicalSm3(receipt);
  }
  console.log(
    `${chainOk ? '✅' : '❌'} ${node}：${ordered.length} 条回执${chainOk ? '，链连续' + (publicKey ? '且逐条验签通过' : '') : ''}`,
  );
  if (!chainOk) {
    console.log(`   断链位置：${brokenAt}`);
    failed = true;
  }
}

if (failed) {
  console.log('\n存在断链或验签失败的节点 —— 该回执链不可信。');
  process.exit(1);
}
console.log('\n全部节点的回执链离线校验通过（未依赖平台判断）。');
