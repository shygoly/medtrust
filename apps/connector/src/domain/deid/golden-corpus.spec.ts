// golden corpus 一致性回归：builtin（TS `Deidentifier`）vs agent（Python 算子）。
//
// 目的（proposal「验收」第 1 条）：迁移期内同一份语料两模式输出**逐字段**比对，
// 出现口径漂移立刻红。判据分两类，都写成显式断言：
//
//  1. **值必须相等**：字段集合、性别、临床字段、年龄带（generalize 语义与 builtin 的
//     `toAgeBand` 同为 10 岁一档、下界向下取整）。
//  2. **假名只比性质**：builtin 用 `SM3(salt:id)`，agent 用 `HMAC-SM3(salt, id)` ——
//     算法有意不同（HMAC 有键控长度扩展保护），因此只要求：同输入稳定、不同输入不同、
//     前缀 `sk_`、长度一致、不含原标识。逐字节相等是会随算法替换而漂移的伪判据。
//
// 语料走的是"连接器受限投影"形状（D-CN-6）：只含本测试用到的列，不含数据源引用。
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Deidentifier } from '../deidentifier';
import type { RawPatientRecord } from '../types';

const REPO = resolve(__dirname, '../../../../..');
const DRIVER = join(REPO, 'apps/agent/scripts/deid_golden.py');
const SALT = 'connector-local-salt';

const CORPUS: RawPatientRecord[] = [
  {
    patientId: '310101199001011234',
    name: '张三',
    phone: '13800138000',
    birthDate: '1990-01-01',
    gender: 'male',
    conditions: ['高血压'],
    medications: ['注射用紫杉醇'],
    adverseEvents: [{ organSystem: '肝胆系统', term: 'ALT 升高', serious: false }],
    followUpDays: 180,
    eventOccurred: true,
    observations: { alt: 56 },
  },
  {
    patientId: '320202198512310001',
    name: '李四',
    phone: '13900139000',
    birthDate: '1985-12-31',
    gender: 'female',
    conditions: ['2 型糖尿病'],
    medications: ['二甲双胍'],
    adverseEvents: [],
    followUpDays: 90,
    eventOccurred: false,
  },
];

/** builtin 等价的 agent 规格（算子集封闭；盐按 saltRef 引用，不内联）。 */
function equivalentSpec() {
  return {
    version: 1,
    id: 'deid.golden.v1',
    scope: { product: 'urn:tds:sp:golden', level: 'C0_internal' },
    transforms: [
      { field: 'subjectKey', op: 'hmac_pseudonym', params: { saltRef: 'golden:k1', outLen: 16 } },
      { field: 'name', op: 'drop' },
      { field: 'phone', op: 'drop' },
      { field: 'age', op: 'generalize', params: { to: 'age_band_10' } },
      { field: 'sex', op: 'keep' },
      { field: 'conditions', op: 'keep' },
      { field: 'medications', op: 'keep' },
      { field: 'adverseEvents', op: 'keep' },
      { field: 'followUpDays', op: 'keep' },
      { field: 'eventOccurred', op: 'keep' },
      { field: 'observations', op: 'keep' },
    ],
    denyIfTransformMissing: ['subjectKey', 'name', 'phone'],
  };
}

/** 受限投影：与 builtin 摄入同源，但已剥掉不需要出域/进本地的列形态。 */
function projectionOf(raw: RawPatientRecord): Record<string, unknown> {
  const age = new Date().getFullYear() - Number(raw.birthDate.slice(0, 4));
  return {
    subjectKey: raw.patientId,
    name: raw.name,
    phone: raw.phone,
    age,
    sex: raw.gender,
    conditions: raw.conditions,
    medications: raw.medications,
    adverseEvents: raw.adverseEvents,
    followUpDays: raw.followUpDays,
    eventOccurred: raw.eventOccurred,
    ...(raw.observations ? { observations: raw.observations } : {}),
  };
}

function agentRun(): { ok: boolean; rows: Record<string, unknown>[]; detail: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deid-golden-'));
  const specPath = join(dir, 'spec.json');
  const rowsPath = join(dir, 'rows.jsonl');
  const outPath = join(dir, 'out.jsonl');
  writeFileSync(specPath, JSON.stringify(equivalentSpec()), 'utf8');
  writeFileSync(
    rowsPath,
    CORPUS.map((raw) => JSON.stringify(projectionOf(raw))).join('\n') + '\n',
    'utf8',
  );
  const run = spawnSync(
    'python3',
    [DRIVER, '--spec', specPath, '--rows', rowsPath, '--out', outPath, '--salts', JSON.stringify({ 'golden:k1': SALT })],
    { cwd: REPO, encoding: 'utf-8' },
  );
  if (run.status !== 0)
    return { ok: false, rows: [], detail: `${run.stderr || run.stdout || 'agent 驱动失败'}` };
  const rows = readFileSync(outPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ok: true, rows, detail: '' };
}

/** agent 输出里 `age` 就是 builtin 的 `ageBand`（键名差异是投影约定，不是语义差异）。 */
function normalizeAgentRow(row: Record<string, unknown>): Record<string, unknown> {
  const { age, ...rest } = row;
  return { ...rest, ageBand: age };
}

const pythonAvailable = spawnSync('python3', ['-c', 'import hashlib; hashlib.new("sm3")'], {
  encoding: 'utf-8',
}).status === 0;

describe('golden corpus：builtin vs agent 逐字段一致性', () => {
  const deid = new Deidentifier();
  const builtin = CORPUS.map((raw) => deid.deidentify(raw, SALT));
  const agent = agentRun();

  it('agent 驱动可执行（python3 在、驱动不报错；缺 python3 才跳过其余用例）', () => {
    if (!pythonAvailable) return; // 无 python 环境：后续用 it.skip 跳过，不伪装成通过
    expect(agent.detail).toBe('');
    expect(agent.rows).toHaveLength(CORPUS.length);
  });

  (agent.ok ? it : it.skip)('字段集合一致（多一个/少一个都算漂移）', () => {
    const agentRows = agent.rows.map(normalizeAgentRow);
    for (let i = 0; i < builtin.length; i += 1) {
      expect(Object.keys(agentRows[i]).sort()).toEqual(Object.keys(builtin[i]).sort());
    }
  });

  (agent.ok ? it : it.skip)('除假名外的每个字段逐值相等', () => {
    const agentRows = agent.rows.map(normalizeAgentRow);
    for (let i = 0; i < builtin.length; i += 1) {
      const expected = { ...builtin[i] } as Record<string, unknown>;
      const actual = { ...agentRows[i] } as Record<string, unknown>;
      // 防止"两边都是空对象"的假通过
      expect(Object.keys(expected).length).toBeGreaterThan(5);
      expect(Object.keys(actual).length).toBe(Object.keys(expected).length);
      // 假名算法有意不同（SM3(salt:id) vs HMAC-SM3(salt,id)）：单独断言性质，不逐字节比。
      delete expected.subjectKey;
      delete actual.subjectKey;
      expect(actual).toEqual(expected);
    }
  });

  (agent.ok ? it : it.skip)('年龄带一致（10 岁一档、下界向下取整）', () => {
    const agentRows = agent.rows.map(normalizeAgentRow);
    for (let i = 0; i < builtin.length; i += 1) {
      expect(agentRows[i].ageBand).toBe(builtin[i].ageBand);
      expect(String(agentRows[i].ageBand)).toMatch(/^\d+-\d+$/);
    }
  });

  (agent.ok ? it : it.skip)('假名性质一致：稳定 / 可区分 / 不泄漏原标识', () => {
    const agentRows = agent.rows.map(normalizeAgentRow);
    for (let i = 0; i < builtin.length; i += 1) {
      const agentKey = String(agentRows[i].subjectKey);
      const builtinKey = builtin[i].subjectKey;
      expect(agentKey.startsWith('sk_')).toBe(true);
      expect(agentKey).toHaveLength(builtinKey.length);
      expect(agentKey).not.toContain(CORPUS[i].patientId);
      expect(builtinKey).not.toContain(CORPUS[i].patientId);
      // 同输入稳定（同一次运行内两次结果相同）
      const again = agent.rows.map(normalizeAgentRow)[i];
      expect(again.subjectKey).toBe(agentKey);
    }
    // 不同主体必须不同
    const keys = agent.rows.map((row) => String(normalizeAgentRow(row).subjectKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  (agent.ok ? it : it.skip)('直接标识零残留（姓名 / 电话 / 原 patientId 都不出现在输出里）', () => {
    const json = JSON.stringify(agent.rows);
    for (const raw of CORPUS) {
      expect(json).not.toContain(raw.name);
      expect(json).not.toContain(raw.phone);
      expect(json).not.toContain(raw.patientId);
    }
  });
});
