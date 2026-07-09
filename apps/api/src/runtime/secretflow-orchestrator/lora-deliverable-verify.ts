import { createHash } from 'crypto';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { loraHashFromAdapter, type AdapterState } from './fed-adapter-merge';
import type { LoraDeliverableRecord } from './lora-deliverable.service';

export type LoraVerifyStepStatus = 'ok' | 'fail' | 'skip';

export interface LoraVerifyStep {
  id: string;
  label: string;
  status: LoraVerifyStepStatus;
  detail?: string;
}

export interface LoraVerifyReport {
  ok: boolean;
  steps: LoraVerifyStep[];
  taskId?: string;
  consumerId?: string;
  format?: string;
  algorithm?: string;
  expectedLoraHash?: string;
  computedLoraHash?: string;
  innerLoraHash?: string;
  adapterTensorKeys?: string[];
  adapterTensorCount?: number;
  plaintextByteSize?: number;
  bundleSha256?: string;
  error?: string;
}

function step(
  steps: LoraVerifyStep[],
  id: string,
  label: string,
  status: LoraVerifyStepStatus,
  detail?: string,
): void {
  steps.push({ id, label, status, detail });
}

function bundleDigest(record: LoraDeliverableRecord): string {
  return createHash('sha256')
    .update(`${record.encryptedData}:${record.encryptedDEK}`)
    .digest('hex');
}

/** Pharma-side decrypt + integrity verification (shared by CLI and API demo endpoint). */
export function verifyLoraDeliverableBundle(
  gm: GMCryptoService,
  bundle: LoraDeliverableRecord,
  privateKey: string,
  expectedLoraHash?: string,
): LoraVerifyReport {
  const steps: LoraVerifyStep[] = [];
  const report: LoraVerifyReport = {
    ok: false,
    steps,
    taskId: bundle.taskId,
    format: bundle.format,
    algorithm: bundle.algorithm,
    expectedLoraHash: expectedLoraHash ?? bundle.loraDeltaHash,
  };

  try {
    if (!bundle.encryptedData || !bundle.encryptedDEK) {
      step(steps, 'parse_bundle', '解析交付包结构', 'fail', '缺少 encryptedData / encryptedDEK');
      report.error = 'invalid bundle';
      return report;
    }
    step(steps, 'parse_bundle', '解析交付包结构', 'ok', `format=${bundle.format}`);

    const digest = bundleDigest(bundle);
    report.bundleSha256 = digest;
    if (bundle.sha256 && digest !== bundle.sha256) {
      step(steps, 'bundle_sha256', '校验包 SHA-256', 'fail', `expected ${bundle.sha256}, got ${digest}`);
      report.error = 'bundle sha256 mismatch';
      return report;
    }
    step(steps, 'bundle_sha256', '校验包 SHA-256', 'ok', digest.slice(0, 16) + '…');

    let plaintext: string;
    try {
      plaintext = gm.envelopeDecrypt(bundle.encryptedData, bundle.encryptedDEK, privateKey);
      step(steps, 'sm2_open_dek', 'SM2 解开数据密钥 (DEK)', 'ok');
      step(steps, 'sm4_decrypt', 'SM4-CBC 解密 LoRA 载荷', 'ok');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step(steps, 'sm2_open_dek', 'SM2 解开数据密钥 (DEK)', 'fail', message);
      report.error = 'decrypt failed';
      return report;
    }

    report.plaintextByteSize = Buffer.byteLength(plaintext, 'utf8');

    let inner: { adapter?: AdapterState; loraDeltaHash?: string; taskId?: string };
    try {
      inner = JSON.parse(plaintext) as typeof inner;
      step(steps, 'parse_inner', '解析内层 JSON (adapter)', 'ok', `${report.plaintextByteSize} bytes`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step(steps, 'parse_inner', '解析内层 JSON (adapter)', 'fail', message);
      report.error = 'inner json invalid';
      return report;
    }

    if (!inner.adapter || typeof inner.adapter !== 'object') {
      step(steps, 'parse_inner', '解析内层 JSON (adapter)', 'fail', '缺少 adapter 字段');
      report.error = 'missing adapter';
      return report;
    }

    report.adapterTensorKeys = Object.keys(inner.adapter).sort();
    report.adapterTensorCount = report.adapterTensorKeys.length;
    report.innerLoraHash = inner.loraDeltaHash;

    const computed = loraHashFromAdapter(inner.adapter);
    report.computedLoraHash = computed;
    step(
      steps,
      'adapter_fingerprint',
      '计算 adapter 指纹 (loraDeltaHash)',
      'ok',
      computed,
    );

    const expected = report.expectedLoraHash;
    if (expected && computed !== expected) {
      step(
        steps,
        'hash_match_task',
        '与控制面 loraDeltaHash 对账',
        'fail',
        `expected ${expected}, computed ${computed}`,
      );
      report.error = 'lora hash mismatch (task)';
      return report;
    }
    step(
      steps,
      'hash_match_task',
      '与控制面 loraDeltaHash 对账',
      expected ? 'ok' : 'skip',
      expected ?? '未提供期望值',
    );

    if (inner.loraDeltaHash && inner.loraDeltaHash !== computed) {
      step(
        steps,
        'hash_match_inner',
        '与内层 loraDeltaHash 自洽',
        'fail',
        `inner ${inner.loraDeltaHash} != computed ${computed}`,
      );
      report.error = 'inner hash mismatch';
      return report;
    }
    step(steps, 'hash_match_inner', '与内层 loraDeltaHash 自洽', 'ok');

    report.ok = true;
    step(steps, 'done', '验证通过 — 可加载 adapter 做内部评估', 'ok');
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.error = message;
    if (!steps.some((s) => s.status === 'fail')) {
      step(steps, 'unexpected', '未知错误', 'fail', message);
    }
    return report;
  }
}
