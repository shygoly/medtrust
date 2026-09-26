import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executionIsolationLabel,
  isExecutionIsolation,
  providerEndorsementLabel,
  admissionTierLabel,
  reviewAttestationLabel,
  trustLevelLabel,
} from './execution-isolation';

const SM3 = 'b2760b0c56727fd77d0cc7d02d005400a0b31fa5b8894042c079e75618867ced';

test('Wasm 沙箱显示模块指纹前 16 位', () => {
  assert.equal(
    executionIsolationLabel('wasm-sandbox', SM3),
    '执行隔离:Wasm 沙箱 · 模块 b2760b0c56727fd7…',
  );
});

test('无隔离如实标注(软件、同进程)', () => {
  assert.equal(executionIsolationLabel('none'), '执行隔离:无隔离(软件、同进程)');
  assert.equal(executionIsolationLabel(undefined), '执行隔离:无隔离(软件、同进程)');
});

test('信任级别不因沙箱而虚标为硬件', () => {
  assert.equal(trustLevelLabel('software'), '信任级别:software(无远程证明)');
  assert.equal(trustLevelLabel(undefined), '信任级别:software(无远程证明)');
  assert.equal(trustLevelLabel('hardware'), '信任级别:硬件远程证明');
});

test('枚举校验只认两个合法值', () => {
  assert.equal(isExecutionIsolation('wasm-sandbox'), true);
  assert.equal(isExecutionIsolation('none'), true);
  assert.equal(isExecutionIsolation('hardware-tee'), false);
  assert.equal(isExecutionIsolation(undefined), false);
});

// on-chain-provider-endorsement —— 按院背书展示口径(task 5.1)。

test('有背书:显示证书指纹前若干位 + 已验签', () => {
  assert.equal(
    providerEndorsementLabel({
      certFingerprint: 'SM2:0123456789ABCDEF0123',
      verified: true,
    }),
    '连接器背书:已验签 · 证书 SM2:0123456789ABCDEF…',
  );
});

test('短指纹不截断', () => {
  assert.equal(
    providerEndorsementLabel({ certFingerprint: 'SM2:ABCD', verified: true }),
    '连接器背书:已验签 · 证书 SM2:ABCD',
  );
});

test('渐进期无背书:如实说"缺",不说"无需"', () => {
  const label = providerEndorsementLabel(undefined);
  assert.match(label, /无\(该院连接器未带结果级签名/);
  assert.doesNotMatch(label, /无需|不必要/);
});

// third-party-module-admission —— 准入层级与审查背书展示（task 7.1）。

test('Tier B 措辞是「平台复现构建 + 审查」，不是「平台保证安全」', () => {
  const label = admissionTierLabel('B');
  assert.match(label, /第三方源码/);
  assert.match(label, /平台复现构建/);
  assert.doesNotMatch(label, /安全|保证|无风险/);
});

test('Tier A / 未标注各有明确文案', () => {
  assert.match(admissionTierLabel('A'), /平台自研源码/);
  assert.match(admissionTierLabel(undefined), /未标注/);
});

test('审查背书只出审查者 + 时间 + 保密范围 + 复现凭据，不出源码', () => {
  const label = reviewAttestationLabel({
    tier: 'B',
    review: {
      reviewer: 'reviewer-zhang',
      reviewedAt: '2026-09-20T00:00:00.000Z',
      reproducibleBuildRef: 'repro:rust:1.95.0:91359f791a853fed6618213c',
      confidential: true,
    },
  });
  assert.match(label, /reviewer-zhang/);
  assert.match(label, /2026-09-20/);
  assert.match(label, /源码保密审查/);
  assert.match(label, /复现构建 repro:rust/);
});

test('Tier A 无独立背书时如实说明是平台自研路径', () => {
  assert.match(reviewAttestationLabel({ tier: 'A' }), /平台自研/);
  assert.equal(reviewAttestationLabel({ tier: 'B' }), '平台审查背书:无');
});
