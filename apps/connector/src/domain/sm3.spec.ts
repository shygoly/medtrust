import { sm3Hex, sm3Fingerprint } from './sm3';

// 国密 SM3 标准测试向量:SM3("abc") 的已知摘要(与 sha256 的 "abc" 摘要截然不同,
// 用以证明底层是真 SM3 而非 sha256)。
const SM3_ABC = '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0';

describe('sm3 — 真国密 SM3(P0-5 伪 SM3 修正)', () => {
  it('sm3("abc") equals the known SM3 digest, not sha256', () => {
    expect(sm3Hex('abc')).toBe(SM3_ABC);
  });

  it('is deterministic and 64 hex chars', () => {
    expect(sm3Hex('x')).toHaveLength(64);
    expect(sm3Hex('x')).toBe(sm3Hex('x'));
  });

  it('fingerprint keeps the "SM3:" prefix + 16 hex of the real digest', () => {
    const fp = sm3Fingerprint('abc');
    expect(fp).toMatch(/^SM3:[0-9a-f]{16}$/);
    expect(fp).toBe('SM3:' + sm3Hex('abc').slice(0, 16));
  });
});
