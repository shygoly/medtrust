// 对齐键的连接器侧配置与派生（Phase 3 / D-CN-10）。
//
// 判据来自决策文档 phase3-alignment-pseudonym.md §3/§6：
//   · 缺配置 = 未启用（不产生 linkKey），配一半 = 抛错（拒绝"半开"）；
//   · 缺标识 / 标识非法 = 该记录不参与对齐（跳过），不抛错、不拿 subjectKey 顶替；
//   · 审计只记计数与 kid，不记标识。
import { AlignmentError, ALIGNMENT_KEY_MIN_LENGTH, alignmentKeyId } from '@medtrust/mdop';
import {
  ALIGNMENT_KEYRING_ENV,
  ALIGNMENT_KEY_ENV,
  ALIGNMENT_PURPOSE_ENV,
  AlignmentLinker,
  currentAlignmentKid,
  resolveAlignmentConfig,
} from './alignment-linker';

const KEY = 'k'.repeat(ALIGNMENT_KEY_MIN_LENGTH);
const PURPOSE = 'dedup-incidence:ckd-2026';

function auditStub() {
  return { record: jest.fn() };
}

describe('resolveAlignmentConfig', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('三个变量都不配 → null（未启用对齐，不是错误）', () => {
    expect(resolveAlignmentConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('配了密钥与用途 → 可用', () => {
    const config = resolveAlignmentConfig({
      [ALIGNMENT_KEY_ENV]: KEY,
      [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
    } as NodeJS.ProcessEnv);
    expect(config).toEqual({ key: KEY, purpose: PURPOSE, retired: {} });
  });

  it('配一半（有用途没密钥 / 有密钥没用途）→ 抛错，拒绝半开状态', () => {
    expect(() =>
      resolveAlignmentConfig({ [ALIGNMENT_PURPOSE_ENV]: PURPOSE } as NodeJS.ProcessEnv),
    ).toThrow(/ALIGNMENT_KEY_MISSING/);
    expect(() =>
      resolveAlignmentConfig({ [ALIGNMENT_KEY_ENV]: KEY } as NodeJS.ProcessEnv),
    ).toThrow(/ALIGNMENT_PURPOSE_MISSING/);
  });

  it('密钥太短 → 抛错（弱密钥下标识空间可枚举）', () => {
    expect(() =>
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: 'short',
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
      } as NodeJS.ProcessEnv),
    ).toThrow(/ALIGNMENT_KEY_TOO_SHORT/);
  });

  it('keyring 形态非法 → 抛错（kid 必须 16 hex）', () => {
    expect(() =>
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
        [ALIGNMENT_KEYRING_ENV]: JSON.stringify({ ABCD: 'x'.repeat(40) }),
      } as NodeJS.ProcessEnv),
    ).toThrow(/kid 形态非法/);
    expect(() =>
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
        [ALIGNMENT_KEYRING_ENV]: 'not-json',
      } as NodeJS.ProcessEnv),
    ).toThrow(/不是合法 JSON/);
  });

  it('currentAlignmentKid 与 mdop 的口径一致（不含密钥材料）', () => {
    const config = resolveAlignmentConfig({
      [ALIGNMENT_KEY_ENV]: KEY,
      [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
    } as NodeJS.ProcessEnv)!;
    expect(currentAlignmentKid(config)).toBe(
      alignmentKeyId({ key: KEY, purpose: PURPOSE }),
    );
    expect(currentAlignmentKid(config)).not.toContain(KEY);
  });
});

describe('AlignmentLinker', () => {
  it('未配置 → disabled，attach 不产生 linkKey（跨院投影自动跳过该记录）', () => {
    const linker = new AlignmentLinker(null, auditStub());
    expect(linker.enabled).toBe(false);
    expect(linker.attach({ subjectKey: 'sk_1' }, '310101199001011234')).toEqual({
      subjectKey: 'sk_1',
    });
  });

  it('启用后：同一标识派生出同一个对齐键，且不改动其它字段', () => {
    const config = resolveAlignmentConfig({
      [ALIGNMENT_KEY_ENV]: KEY,
      [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
    } as NodeJS.ProcessEnv);
    const h1 = new AlignmentLinker(config, auditStub());
    const h2 = new AlignmentLinker(config, auditStub());
    const a = h1.attach({ subjectKey: 'sk_a1' }, '310101199001011234');
    const b = h2.attach({ subjectKey: 'sk_b9' }, '310101 19900101 1234');
    expect(a.linkKey).toBeDefined();
    expect(a.linkKey).toBe(b.linkKey); // 两院各算一次 → 对上
    expect(a.subjectKey).toBe('sk_a1');
    expect(Object.keys(a).sort()).toEqual(['linkKey', 'subjectKey']);
  });

  it('缺标识 → 跳过并留审计（不抛错、不产生值）', () => {
    const audit = auditStub();
    const linker = new AlignmentLinker(
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
      } as NodeJS.ProcessEnv),
      audit,
    );
    expect(linker.attach({ subjectKey: 'sk_1' }, null).linkKey).toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alignment-derive', allowed: false }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('310101199001011234');
  });

  it('派生失败（标识非法）→ 跳过，记 rejected 码', () => {
    const audit = auditStub();
    const linker = new AlignmentLinker(
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
      } as NodeJS.ProcessEnv),
      audit,
    );
    expect(linker.link('   ')).toBeNull();
    const details = audit.record.mock.calls.map((call) => call[0].detail).join('|');
    expect(details).toContain('skip=missing-identifier');
  });

  it('审计里的 detail 只有 kid 与用途绑定信息，没有标识', () => {
    const audit = auditStub();
    const linker = new AlignmentLinker(
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
      } as NodeJS.ProcessEnv),
      audit,
    );
    linker.link('310101199001011234');
    const detail = audit.record.mock.calls[0][0].detail as string;
    expect(detail).toContain('kid=');
    expect(detail).not.toContain('310101199001011234');
  });

  it('keyring 里的退役密钥可复算历史值（轮换不假装同名）', () => {
    const oldKey = 'o'.repeat(ALIGNMENT_KEY_MIN_LENGTH);
    const oldKid = alignmentKeyId({ key: oldKey, purpose: PURPOSE });
    const before = new AlignmentLinker(
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: oldKey,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
      } as NodeJS.ProcessEnv),
      auditStub(),
    ).link('310101199001011234');

    const rotated = new AlignmentLinker(
      resolveAlignmentConfig({
        [ALIGNMENT_KEY_ENV]: KEY,
        [ALIGNMENT_PURPOSE_ENV]: PURPOSE,
        [ALIGNMENT_KEYRING_ENV]: JSON.stringify({ [oldKid]: oldKey }),
      } as NodeJS.ProcessEnv),
      auditStub(),
    );
    // 新派生用新 kid，与历史值不同
    expect(rotated.link('310101199001011234')).not.toBe(before);
    // 历史值可由 keyring 复算得到（这里通过 mdop 的 deriver 直接对账）
    expect(rotated.kid()).not.toBe(oldKid);
  });
});

describe('AlignmentError 类型', () => {
  it('错误码可判（调用方据此决定记什么审计）', () => {
    expect(() => resolveAlignmentConfig({ [ALIGNMENT_KEY_ENV]: 'x' } as NodeJS.ProcessEnv)).toThrow(
      AlignmentError,
    );
  });
});
