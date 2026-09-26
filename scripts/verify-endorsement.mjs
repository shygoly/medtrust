#!/usr/bin/env node
// on-chain-provider-endorsement — **离线**独立核验器(task 4.1 / 4.3)。
//
// 这支脚本刻意不认识 MedTrust 平台:它只吃两样东西 —— 链上取到的存证 payload、
// 公开发布的平台 CA 公钥 —— 然后做两步纯密码学验证:
//   ① 平台 CA 公钥验连接器证书签名(证书链);
//   ② 证书里的连接器公钥验 `medtrust.result-endorsement.v1:<resultSm3>` 的签名。
// 两步都过 = 「该院确实背书了这份结果哈希」,不需要向平台或医院请求任何东西。
//
// 签名格式（D-MDOP-3 / 任务 4.2）：优先按**国标口径**（GM/T 0003 的 Z_A + GM/T 0009 的 DER）
// 验签；只有在记录属于**切换之前**上链的历史存证时才回落到旧格式（不做 Z_A、原始 r‖s）。
// 判定用记录时间：`--legacy-before <ISO>`（缺省取 `SM2_LEGACY_CUTOFF` 环境变量，
// 再缺省 2026-09-24T00:00:00Z，即本变更落地日）。切换后的记录若只有旧格式签名，一律判失败 ——
// 否则「降级到旧格式」就成了可用的攻击路径。
//
// 用法:
//   node scripts/verify-endorsement.mjs --anchor trust-anchor.json --attestation onchain.json
//   node scripts/verify-endorsement.mjs --from-api http://localhost:5021/api/v1 --attestation onchain.json
//
// onchain.json 形如(即 attestation.metadata,链上 payload):
//   { "endorsements": [ { "participantId": "...", "resultSm3": "...",
//                         "sig": "...", "certFingerprint": "..." } ] }
// 证书目录可随 --certs certs.json 提供;不给则从 --from-api 拉(拉证书只是取公开数据,
// 不影响「核验本身不依赖平台」—— 证书也可以从任何镜像/归档拿到)。
import { readFileSync } from 'node:fs';
import { SM2_ALGORITHM, SM2_LEGACY_ALGORITHM, sm2Verify, verifyLegacySm2 } from '@medtrust/mdop';

const ENDORSEMENT_PREFIX = 'medtrust.result-endorsement.v1:';
/** 本变更落地日：此日之前的链上记录才允许旧格式签名。 */
const DEFAULT_LEGACY_CUTOFF = '2026-09-24T00:00:00Z';

/**
 * 先国标、后历史。`recordedAt` 缺失时按「时间未知」处理：
 * 只接受国标格式（fail-closed），旧格式判失败并说明原因。
 */
function verifySignature(payload, sig, publicKey, recordedAt, legacyCutoff) {
  if (sm2Verify(payload, sig, publicKey)) {
    return { ok: true, alg: SM2_ALGORITHM };
  }
  const at = recordedAt ? Date.parse(recordedAt) : NaN;
  const cutoff = Date.parse(legacyCutoff);
  const isPreSwitch = Number.isFinite(at) && Number.isFinite(cutoff) && at < cutoff;
  if (!isPreSwitch) {
    return {
      ok: false,
      alg: null,
      reason: recordedAt
        ? `签名不是国标口径，且记录时间 ${recordedAt} 不早于切换点 ${legacyCutoff}`
        : `签名不是国标口径，且记录未带时间（无法证明属于切换前上链）`,
    };
  }
  if (verifyLegacySm2(payload, sig, publicKey)) {
    return { ok: true, alg: SM2_LEGACY_ALGORITHM, historical: true };
  }
  return { ok: false, alg: null };
}

function endorsementPayload(resultSm3) {
  return `${ENDORSEMENT_PREFIX}${String(resultSm3).toLowerCase()}`;
}

/** 证书被签载荷 —— 必须与 CaService.payload 一致。 */
function certificatePayload(cert) {
  return JSON.stringify({
    spaceId: cert.spaceId,
    connectorId: cert.connectorId,
    participantId: cert.participantId,
    subjectPublicKey: cert.subjectPublicKey,
    validUntil: cert.validUntil,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function verifyOne(endorsement, certsByFingerprint, caPublicKey, legacyCutoff) {
  const steps = {
    certificateFound: false,
    certificateChainValid: false,
    certificateActive: false,
    participantMatches: false,
    endorsementSignatureValid: false,
  };
  const cert = certsByFingerprint.get(endorsement.certFingerprint);
  if (!cert) return { valid: false, steps, reason: '证书指纹不在目录中' };
  steps.certificateFound = true;

  const caSig = cert.caSignature ?? cert.signature;
  if (!caSig) return { valid: false, steps, reason: '证书未带 CA 签名，无法验证书链' };
  // 证书链按「历史核验面」处理：证书目录不带签发时间，且切换前签发的证书可能仍在有效期内，
  // 故两种格式都接受 —— 信任锚是 CA 公钥本身，如实标注命中的格式即可。
  const chain = verifySignature(
    certificatePayload(cert),
    caSig,
    caPublicKey,
    null,
    '9999-01-01T00:00:00Z',
  );
  steps.certificateChainValid = chain.ok;
  if (!chain.ok) return { valid: false, steps, reason: '证书签名非该 CA 签发或被篡改' };

  steps.certificateActive =
    !cert.revoked && new Date(cert.validUntil).getTime() >= Date.now();
  if (!steps.certificateActive) {
    return { valid: false, steps, reason: '证书已吊销或已过期' };
  }

  steps.participantMatches = cert.participantId === endorsement.participantId;
  if (!steps.participantMatches) {
    return { valid: false, steps, reason: '证书归属方与背书声称的贡献方不符' };
  }

  const certAlg = chain.alg;
  const endorsementAt =
    endorsement.at ?? endorsement.anchoredAt ?? endorsement.recordedAt ?? null;
  const sig = verifySignature(
    endorsementPayload(endorsement.resultSm3),
    endorsement.sig,
    cert.subjectPublicKey,
    endorsementAt,
    legacyCutoff,
  );
  steps.endorsementSignatureValid = sig.ok;
  return {
    valid: sig.ok,
    steps,
    signatureAlg: sig.alg,
    certificateAlg: certAlg,
    ...(sig.alg === SM2_LEGACY_ALGORITHM
      ? { note: '旧格式签名：仅因记录早于切换点才被接受（历史存证）' }
      : {}),
    reason: sig.ok
      ? undefined
      : sig.reason ?? '背书签名与该 resultSm3 不符（结果或签名被篡改）',
  };
}

export async function verifyAttestation({ attestation, anchor, certs, legacyBefore }) {
  const endorsements = attestation?.endorsements ?? attestation?.metadata?.endorsements ?? [];
  const byFp = new Map(
    (certs?.certificates ?? certs ?? []).map((c) => [c.fingerprint ?? c.sm2Fingerprint, c]),
  );
  const caPublicKey = anchor?.caPublicKey ?? certs?.caPublicKey;
  if (!caPublicKey) throw new Error('缺少平台 CA 公钥（--anchor / --from-api）');
  const legacyCutoff =
    legacyBefore ?? process.env.SM2_LEGACY_CUTOFF ?? DEFAULT_LEGACY_CUTOFF;
  return endorsements.map((e) => ({
    participantId: e.participantId,
    resultSm3: e.resultSm3,
    ...verifyOne(e, byFp, caPublicKey, legacyCutoff),
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.attestation) {
    console.error(
      '用法: node scripts/verify-endorsement.mjs --attestation <onchain.json> ' +
        '[--anchor <trust-anchor.json>] [--certs <certs.json>] [--from-api <baseUrl>]',
    );
    process.exit(2);
  }
  const attestation = readJson(args.attestation);
  const anchor = args.anchor
    ? readJson(args.anchor)
    : args['from-api']
      ? await fetchJson(`${args['from-api'].replace(/\/$/, '')}/attestation/trust-anchor`)
      : null;
  const certs = args.certs
    ? readJson(args.certs)
    : args['from-api']
      ? await fetchJson(`${args['from-api'].replace(/\/$/, '')}/attestation/certificates`)
      : null;

  const results = await verifyAttestation({
    attestation,
    anchor,
    certs,
    legacyBefore: args['legacy-before'],
  });
  if (results.length === 0) {
    console.error('存证 payload 未含任何连接器背书（渐进期旧记录只锚 resultHash）');
    process.exit(1);
  }
  let allOk = true;
  for (const r of results) {
    const mark = r.valid ? '✅' : '❌';
    console.log(
      `${mark} ${r.participantId} resultSm3=${String(r.resultSm3).slice(0, 16)}…` +
        (r.valid
          ? ` 背书有效（签名格式 ${r.signatureAlg}${r.note ? `；${r.note}` : ''}）`
          : ` 核验失败: ${r.reason}`),
    );
    if (!r.valid) {
      console.log(`   steps=${JSON.stringify(r.steps)}`);
      allOk = false;
    }
  }
  console.log(
    allOk
      ? `\n全部 ${results.length} 家医院的背书独立核验通过（未依赖平台判断）。`
      : '\n存在核验失败的背书 —— 该存证记录不可信。',
  );
  process.exit(allOk ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`核验失败: ${err.message}`);
    process.exit(1);
  });
}
