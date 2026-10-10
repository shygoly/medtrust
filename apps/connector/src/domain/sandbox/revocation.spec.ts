// third-party-module-admission 闸 5 —— 吊销（tasks 5.4 / 5.5）+ 合约固定条款完整性。
//
// 吊销的三条路各自独立生效：吊销名单（本文件）、撤合约固定（SM3 不符）、撤签名。
// 共同的红线：**吊销即拒，且不回退到内置实现**（D-UC-2）。
import type { RevocationList } from '@medtrust/wasm-algorithms';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint, PolicyViolation } from '../policy-enforcement';
import { ConnectorModuleClient } from './module-client';
import { ModuleVerificationError, verifyModule } from './module-verifier';
import {
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
  newTestCa,
} from './__fixtures__/platform-module';

const SM3 = PLATFORM_MODULE_SM3;
const OTHER_SM3 = 'f'.repeat(64);

function revocationList(
  version: number,
  sm3s: string[],
): RevocationList {
  return {
    version,
    issuedAt: new Date().toISOString(),
    revoked: sm3s.map((sm3) => ({
      sm3,
      reason: 'security-incident' as const,
      revokedAt: new Date().toISOString(),
      revokedBy: 'platform-review',
    })),
  };
}

const REVIEW = {
  reviewer: 'platform-review',
  reviewedAt: '2026-09-20T00:00:00.000Z',
  reproducibleBuildRef: `repro:rust:1.95.0:${SM3}`,
  confidential: true,
};

function contract(over: Partial<ContractView> = {}): ContractView {
  return {
    id: 'c1',
    providerId: 'p-demohospa',
    consumerId: 'p-meddata',
    purpose: 'PV',
    retention: '阅后即焚',
    output: '仅聚合',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    ...over,
  } as ContractView;
}

describe('verifyModule —— 吊销检查排在最前（task 5.5）', () => {
  const ca = newTestCa();
  const signature = ca.sign(PLATFORM_MODULE_BYTES);

  const opts = (list?: RevocationList) => ({
    analysisType: 'disproportionality',
    expectedSm3: SM3,
    signature,
    registryPublicKey: ca.publicKey,
    revocationList: list,
  });

  it('未吊销 + 签名正确 + 过闸 1 → 通过，并回带闸 1 报告', () => {
    const verified = verifyModule(PLATFORM_MODULE_BYTES, opts());
    expect(verified.sm3).toBe(SM3);
    expect(verified.gate.abiVersionExportKind).toBe('global');
    expect(verified.gate.checks).toContain('no-start-section');
  });

  it('已吊销 → 当场拒（reason=revoked），连签名都不必验', () => {
    let err: ModuleVerificationError | undefined;
    try {
      verifyModule(PLATFORM_MODULE_BYTES, opts(revocationList(3, [SM3])));
    } catch (e) {
      err = e as ModuleVerificationError;
    }
    expect(err).toBeInstanceOf(ModuleVerificationError);
    expect(err!.reason).toBe('revoked');
    expect(err!.message).toMatch(/不回退到内置实现/);
  });

  it('名单里是别的模块 → 不误伤', () => {
    expect(() =>
      verifyModule(PLATFORM_MODULE_BYTES, opts(revocationList(3, [OTHER_SM3]))),
    ).not.toThrow();
  });

  it('SM3 与合约固定值不符 → 拒（撤合约固定这条路，task 5.5）', () => {
    expect(() =>
      verifyModule(PLATFORM_MODULE_BYTES, {
        ...opts(),
        expectedSm3: OTHER_SM3,
      }),
    ).toThrow(/SM3 与合约固定值不符/);
  });

  it('换一个 CA 的签名 → 拒（撤签名这条路）', () => {
    expect(() =>
      verifyModule(PLATFORM_MODULE_BYTES, {
        ...opts(),
        registryPublicKey: newTestCa().publicKey,
      }),
    ).toThrow(/签名验证失败/);
  });
});

describe('ConnectorModuleClient —— 吊销名单按版本合并（task 5.4）', () => {
  function client(): ConnectorModuleClient {
    return new ConnectorModuleClient(
      { fetchModule: async () => ({}) } as never,
      new AuditService(),
    );
  }

  it('收下更高版本的名单；模块随即被判吊销', () => {
    const c = client();
    expect(c.isRevoked(SM3)).toBe(false);
    c.applyRevocationList(revocationList(1, [SM3]));
    expect(c.isRevoked(SM3)).toBe(true);
    expect(c.revocationList().version).toBe(1);
  });

  it('回放旧名单不能把吊销「撤销」掉', () => {
    const c = client();
    c.applyRevocationList(revocationList(5, [SM3]));
    c.applyRevocationList(revocationList(2, [])); // 旧版本的空名单
    expect(c.isRevoked(SM3)).toBe(true);
    expect(c.revocationList().version).toBe(5);
  });

  it('同版本重复下发不产生变化', () => {
    const c = client();
    c.applyRevocationList(revocationList(4, [SM3]));
    c.applyRevocationList(revocationList(4, []));
    expect(c.isRevoked(SM3)).toBe(true);
  });

  it('未下发名单时不误判为已吊销', () => {
    expect(client().isRevoked(SM3)).toBe(false);
  });
});

describe('PEP —— 执行前吊销检查与固定条款完整性（usage-control 增量）', () => {
  function pep(list?: RevocationList): PolicyEnforcementPoint {
    return new PolicyEnforcementPoint(new AuditService(), {
      revocationList: () => list ?? { version: 0, issuedAt: '', revoked: [] },
    });
  }

  const task = {
    taskId: 't1',
    purpose: 'PV',
    analysisType: 'disproportionality',
    moduleSm3: SM3,
  };

  it('未吊销 + SM2/SM3 校验通过 → 放行', () => {
    expect(() =>
      pep().check(
        task,
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, tier: 'B', review: REVIEW },
          },
        }),
      ),
    ).not.toThrow();
  });

  it('已吊销 → PEP 拒，任务失败，且明说不回退', () => {
    expect(() =>
      pep(revocationList(2, [SM3])).check(
        task,
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, tier: 'B', review: REVIEW },
          },
        }),
      ),
    ).toThrow(PolicyViolation);
    try {
      pep(revocationList(2, [SM3])).check(
        task,
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, tier: 'B', review: REVIEW },
          },
        }),
      );
    } catch (err) {
      expect((err as Error).message).toMatch(/已吊销/);
      expect((err as Error).message).toMatch(/不回退到内置实现/);
    }
  });

  it('固定条款缺准入层级 → 拒（不得固定来路不明的模块）', () => {
    expect(() =>
      pep().check(
        task,
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, review: REVIEW } as never,
          },
        }),
      ),
    ).toThrow(/缺少准入层级/);
  });

  it('固定条款缺平台审查背书 → 拒', () => {
    expect(() =>
      pep().check(
        task,
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, tier: 'B' } as never,
          },
        }),
      ),
    ).toThrow(/缺少平台审查背书/);
  });

  it('旧口径（纯 SM3 字符串，平台自研）仍然合法', () => {
    expect(() =>
      pep().check(
        task,
        contract({ pinnedModules: { disproportionality: SM3 } }),
      ),
    ).not.toThrow();
  });

  it('合约固定了模块但任务没带模块引用 → 拒（不以内置实现代替）', () => {
    expect(() =>
      pep().check(
        { ...task, moduleSm3: undefined },
        contract({
          pinnedModules: {
            disproportionality: { sm3: SM3, tier: 'B', review: REVIEW },
          },
        }),
      ),
    ).toThrow(/拒绝执行\(不以内置实现代替\)/);
  });
});
