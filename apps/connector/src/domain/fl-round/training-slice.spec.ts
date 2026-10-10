// omop-data-source-access task 4.3 —— 连接器投影的联邦训练切片。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Deidentifier } from '../deidentifier';
import { defaultConnectorDataRoot } from '../local-data-path';
import { loadSyntheaPatientFile } from '../synthea-patient-loader';
import { InternalRecord } from '../types';
import {
  FL_STRUCTURED_EHR_FEATURES,
  TRAINING_SLICE_SCHEMA,
  buildTrainingSlice,
  esrdProxyLabel,
} from './training-slice';

function rec(partial: Partial<InternalRecord> & { subjectKey: string }): InternalRecord {
  return {
    ageBand: '60-69',
    conditions: [],
    medications: [],
    adverseEvents: [],
    ...partial,
  };
}

describe('联邦训练切片（连接器投影，4.3）', () => {
  it('特征按固定顺序取数值观测，缺的记 0；标签按规范化术语与英文原文判定', () => {
    const slice = buildTrainingSlice([
      rec({
        subjectKey: 'sk_b',
        conditions: ['慢性肾病', '高血压'],
        observations: { 'Body Height': 172, Glucose: 6.1, 'Heart rate': 72 },
      }),
      rec({ subjectKey: 'sk_a', conditions: ['Essential hypertension (disorder)'] }),
      rec({ subjectKey: 'sk_c', conditions: ['Chronic kidney disease stage 2 (disorder)'] }),
    ]);
    expect(slice.schema).toBe(TRAINING_SLICE_SCHEMA);
    expect(slice.featureKeys).toEqual([...FL_STRUCTURED_EHR_FEATURES]);
    // 按假名排序：sk_a, sk_b, sk_c
    expect(slice.rows).toEqual([
      [0, 0, 0, 0, 0, 0, 0],
      [172, 0, 0, 72, 0, 0, 6.1],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    expect(slice.labels).toEqual([0, 1, 1]);
  });

  it('切片里只有模型用得到的东西：没有假名、年龄段、性别、用药、诊断文本', () => {
    const slice = buildTrainingSlice([
      rec({
        subjectKey: 'sk_secret_pseudonym',
        sex: 'F',
        ageBand: '70-79',
        conditions: ['终末期肾病'],
        medications: ['注射用紫杉醇'],
        followUpDays: 400,
      }),
    ]);
    expect(Object.keys(slice).sort()).toEqual(['featureKeys', 'labels', 'rows', 'schema']);
    const wire = JSON.stringify(slice);
    for (const leaked of ['sk_secret_pseudonym', '70-79', '终末期肾病', '紫杉醇', '"F"', '400']) {
      expect(wire).not.toContain(leaked);
    }
    // 只有数字
    expect(slice.rows.flat().every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
  });

  it('同一份数据不论输入顺序，切片逐字节相同（训练可复现）', () => {
    const records = ['sk_3', 'sk_1', 'sk_2'].map((k, i) =>
      rec({ subjectKey: k, conditions: i === 0 ? ['肾炎'] : [], observations: { Glucose: i } }),
    );
    const a = JSON.stringify(buildTrainingSlice(records));
    const b = JSON.stringify(buildTrainingSlice([...records].reverse()));
    expect(a).toBe(b);
  });

  it('Synthea 摄入件的数值观测经去标识后进入切片，非数值项丢弃', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-slice-obs-'));
    const file = path.join(dir, 'patient-x.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        patientId: 'p-x',
        name: '张三',
        birthDate: '1960-05-01',
        conditions: ['Chronic kidney disease stage 3 (disorder)'],
        medications: [],
        observations: [
          { code: 'Body Weight', value: 70.5 },
          { code: 'Glucose', value: 'high' },
          { code: 'Heart rate', value: 80 },
        ],
      }),
    );
    const [raw] = loadSyntheaPatientFile(file);
    const internal = new Deidentifier().deidentify(raw);
    expect(internal.observations).toEqual({ 'Body Weight': 70.5, 'Heart rate': 80 });
    expect(JSON.stringify(internal)).not.toContain('张三');
    const slice = buildTrainingSlice([internal]);
    expect(slice.rows[0]).toEqual([0, 70.5, 0, 80, 0, 0, 0]);
    expect(slice.labels).toEqual([1]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('标签口径迁移：演示数据上与 agent 旧口径逐人一致', () => {
    // agent 旧口径：对**原始英文诊断文本**拼接后跑这条正则（synthea_loader._label_from_conditions）。
    const AGENT_OLD = /kidney|renal|neph|ckd|esrd|dialysis|glomer|creatinine|egfr|uacr/i;
    const root = defaultConnectorDataRoot();

    for (const site of ['demohospa', 'demohospb']) {
      const dir = path.join(root, 'data', 'synthea', 'connectors', site);
      const present = fs.existsSync(dir);
      (present ? it : it.skip)(`${site}：每个病人新旧标签相同`, () => {
        const files = fs.readdirSync(dir).filter((f) => /^patient-.*\.json$/.test(f));
        expect(files.length).toBeGreaterThan(0);
        const deid = new Deidentifier();
        const mismatches: string[] = [];
        let positives = 0;
        for (const f of files) {
          const rawJson = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          const oldLabel = AGENT_OLD.test(((rawJson.conditions as string[]) ?? []).join(' ')) ? 1 : 0;
          const [raw] = loadSyntheaPatientFile(path.join(dir, f));
          const newLabel = esrdProxyLabel(deid.deidentify(raw));
          if (oldLabel !== newLabel) mismatches.push(f);
          positives += newLabel;
        }
        expect(mismatches).toEqual([]);
        expect(positives).toBeGreaterThan(0);
      });
    }
  });
});
