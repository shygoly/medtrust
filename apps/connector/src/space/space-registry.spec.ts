import {
  DEFAULT_CONNECTOR_SPACE,
  currentConnectorSpaceId,
  resetConnectorSpaceWarningForTest,
  runInConnectorSpace,
} from './space-context';
import {
  ConnectorKeyReuseError,
  ConnectorSpaceRegistry,
} from './space-registry';
import { DEFAULT_LOCAL_EGRESS, LocalPolicyRegistry } from './local-policy';

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);

function registry(): ConnectorSpaceRegistry {
  const r = new ConnectorSpaceRegistry();
  r.register({ spaceId: 'sh-med', participantId: 'p-huashan', privateKey: KEY_A });
  r.register({ spaceId: 'bj-med', participantId: 'p-huashan', privateKey: KEY_B });
  return r;
}

describe('连接器多空间装配（P10 / D-SPD-2）', () => {
  it('一台连接器服务两个空间：URN 与公钥各自独立', () => {
    const r = registry();
    expect(r.spaceIds()).toEqual(['bj-med', 'sh-med']);
    expect(r.selfUrn('sh-med')).toBe('urn:tds:sh-med:participant:p-huashan');
    expect(r.selfUrn('bj-med')).toBe('urn:tds:bj-med:participant:p-huashan');
    expect(r.platformUrn('sh-med')).toBe('urn:tds:sh-med:participant:platform');
    expect(r.publicKey('sh-med')).not.toEqual(r.publicKey('bj-med'));
    expect(r.publicKey('sh-med')).toMatch(/^04[0-9a-f]{128}$/); // SM2 未压缩公钥
  });

  it('负例：同一把私钥注册到两个空间 → 拒绝（跨空间密钥不复用）', () => {
    const r = new ConnectorSpaceRegistry();
    r.register({ spaceId: 'sh-med', participantId: 'p-a', privateKey: KEY_A });
    expect(() =>
      r.register({ spaceId: 'bj-med', participantId: 'p-a', privateKey: KEY_A.toUpperCase() }),
    ).toThrow(ConnectorKeyReuseError);
    expect(r.spaceIds()).toEqual(['sh-med']);
  });

  it('负例：未加入的空间解析即拒', () => {
    const r = registry();
    expect(() => r.get('gz-med')).toThrow(/CONNECTOR_SPACE_NOT_JOINED/);
    expect(() => r.selfUrn('gz-med')).toThrow(/NOT_JOINED/);
  });

  it('空间上下文：ALS 优先，env 兜底并告警，最后默认空间', () => {
    resetConnectorSpaceWarningForTest();
    const prev = process.env.SPACE_ID;
    try {
      delete process.env.SPACE_ID;
      expect(currentConnectorSpaceId()).toBe(DEFAULT_CONNECTOR_SPACE);
      runInConnectorSpace('bj-med', () => {
        expect(currentConnectorSpaceId()).toBe('bj-med');
      });
      process.env.SPACE_ID = 'legacy-space';
      expect(currentConnectorSpaceId()).toBe('legacy-space');
      runInConnectorSpace('sh-med', () => {
        expect(currentConnectorSpaceId()).toBe('sh-med');
      });
    } finally {
      if (prev === undefined) delete process.env.SPACE_ID;
      else process.env.SPACE_ID = prev;
    }
  });

  it('本地策略按空间独立：一空间更严时以更严为准（fail-closed）', () => {
    const p = new LocalPolicyRegistry();
    p.set('bj-med', { minimumCount: 20, allowedArtifacts: ['aggregate'] });
    expect(p.get('sh-med')).toEqual(DEFAULT_LOCAL_EGRESS);
    expect(p.effectiveMinimumCount('sh-med', 5)).toBe(5);
    expect(p.effectiveMinimumCount('bj-med', 5)).toBe(20);
    expect(p.effectiveMinimumCount('bj-med', 50)).toBe(50);
    expect(p.effectiveArtifacts('bj-med', ['aggregate', 'model-delta'])).toEqual(['aggregate']);
  });
});
