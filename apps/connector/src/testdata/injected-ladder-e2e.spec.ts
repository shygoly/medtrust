import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { LocalStore } from '../domain/local-store';
import { disproportionalityTables } from '../domain/rws-executor';
import { createTestMdopExecutor } from '../test/mdop-local-executor';
import { LocalDataLoader } from '../domain/local-data-loader';
import { FhirGateway } from '../domain/fhir-gateway';
import {
  defaultConnectorDataRoot,
  resolveLocalDataPath,
} from '../domain/local-data-path';
import {
  goldFromInjectedTruth,
  impliedSeSp,
} from '../domain/algorithm-validation/synthetic-gold-standard';
import {
  cellsFromRecords,
  crudeOddsRatio,
  stratifiedOddsRatio,
  confusionFromTruth,
  injectSignal,
  syntheticBase,
  DEFAULT_INJECTION,
  type AnswerKey,
  type SubjectTruth,
  type InjectionParams,
} from './signal-injection';
import type { InternalRecord } from '../domain/types';

/**
 * Task 5 — 阶梯 e2e 消费注入数据并对拍 answer key (D-DATA-1).
 *
 * 替换原先「无 Synthea 就 describe.skip」的空跑：有 `data/rws-test-data/`
 * 就验「管道复原了注入真值」。观测 OR < 注入 HR 是编码错分向零衰减，属
 * **正确**流行病学现象（design D2），不得当失败。
 */

const DATA_DIR = 'data/rws-test-data';
const root = defaultConnectorDataRoot();
const dataPath = resolveLocalDataPath(DATA_DIR, root);
const dataExists = fs.existsSync(path.join(dataPath, 'records.json'));

function loadAnswerKey(): AnswerKey {
  return JSON.parse(
    fs.readFileSync(path.join(dataPath, 'answer-key.json'), 'utf-8'),
  ) as AnswerKey;
}

function loadTruth(): SubjectTruth[] {
  return JSON.parse(
    fs.readFileSync(path.join(dataPath, 'truth.json'), 'utf-8'),
  ) as SubjectTruth[];
}

function siteRecords(records: InternalRecord[], site: string): InternalRecord[] {
  return records.filter((r) => r.subjectKey.startsWith(`${site}-`));
}

function siteTruth(truth: SubjectTruth[], site: string): SubjectTruth[] {
  return truth.filter((t) => t.site === site);
}

(dataExists ? describe : describe.skip)(
  'injected-ladder-e2e — 消费注入数据复原 answer key (Task 5)',
  () => {
    let records: InternalRecord[];
    let truth: SubjectTruth[];
    let answerKey: AnswerKey;
    let params: InjectionParams;

    beforeAll(() => {
      const loader = new LocalDataLoader(new Deidentifier(), new FhirGateway());
      const loaded = loader.loadFromDeclaredPath(DATA_DIR, root);
      expect(loaded.format).toBe('internal_records');
      records = loaded.records;
      truth = loadTruth();
      answerKey = loadAnswerKey();
      params = answerKey.params;
    });

    it('5.1 loads injected InternalRecords (not Synthea comorbidity AE)', () => {
      expect(records.length).toBe(answerKey.totalSubjects);
      expect(records.every((r) => r.conditions.includes('synthetic-injected'))).toBe(
        true,
      );
      const withAe = records.filter((r) => r.adverseEvents.length > 0);
      expect(withAe.length).toBeGreaterThan(0);
      expect(
        withAe.every((r) =>
          r.adverseEvents.every((e) => e.term === params.outcomeTerm),
        ),
      ).toBe(true);
    });

    it('5.2 L1.5: 两院四格过闸 + 合并出信号(OR>1,方向对)', async () => {
      const siteOrs: number[] = [];
      for (const site of ['demohospa', 'demohospb'] as const) {
        const sr = siteRecords(records, site);
        const c = cellsFromRecords(sr, params);
        expect(Math.min(c.a, c.b, c.c, c.d)).toBeGreaterThanOrEqual(5);
        expect(answerKey.perSite[site].trueEvents).toBeGreaterThanOrEqual(300);

        // 经适配器（L1.5 已迁 MDOP）出失衡聚合(无行级字段)
        const store = new LocalStore(new AuditService());
        store.replaceAll(sr);
        const exec = createTestMdopExecutor({ id: 'spec-injected-ladder', store, localL15: true });
        const agg = await exec.run({
          type: 'disproportionality',
          level: 'L1.5',
          drug: params.exposureDrug,
        });
        expect(agg.analysisType).toBe('disproportionality');
        expect(JSON.stringify(agg)).not.toContain('subjectKey');
        const bucket = agg.buckets.find((b) => b.key === params.outcomeTerm);
        expect(bucket).toBeDefined();
        expect(bucket!.count).toBe(c.a);
        expect(bucket!.b).toBe(c.b);
        expect(bucket!.c).toBe(c.c);
        expect(bucket!.d).toBe(c.d);

        const or = crudeOddsRatio(c);
        expect(or).toBeGreaterThan(1);
        siteOrs.push(or);
      }

      // 合并两院:直接合并列联(联邦演示的方向性验收)
      const merged = cellsFromRecords(records, params);
      const mergedOr = crudeOddsRatio(merged);
      expect(mergedOr).toBeGreaterThan(1);
      expect(mergedOr).toBeGreaterThan(1.3); // 信号方向明确
      // 两院各自也出信号
      expect(siteOrs.every((or) => or > 1)).toBe(true);

      // 控制面合并形态:两院聚合再拼(无行级)
      const hAgg = disproportionalityTables(
        siteRecords(records, 'demohospa'),
        params.exposureDrug,
      );
      const rAgg = disproportionalityTables(
        siteRecords(records, 'demohospb'),
        params.exposureDrug,
      );
      expect(hAgg.cohortSize + rAgg.cohortSize).toBe(records.length);
    }, 20_000);

    it('5.3 L3: crude 与 Z 分层 MH 可测差异;时间到事件供 Cox/KM', () => {
      const crude = crudeOddsRatio(cellsFromRecords(records, params));
      // Mantel-Haenszel by injected confounder Z (truth) — L3 调整的粗版
      const mh = stratifiedOddsRatio(records, truth, params);
      // 正混杂(by indication):crude 偏高,分层后向真值回落
      expect(Math.abs(crude - mh)).toBeGreaterThan(0.03);
      expect(crude).toBeGreaterThan(mh);

      // 时间到事件:真阳性全有 timeToEventDays;记录带 followUpDays/eventOccurred
      const trueEvents = truth.filter((t) => t.truePancreatitis);
      expect(trueEvents.length).toBeGreaterThan(0);
      expect(
        trueEvents.every(
          (t) => typeof t.timeToEventDays === 'number' && t.timeToEventDays! >= 1,
        ),
      ).toBe(true);
      const codedPos = records.filter((r) => r.eventOccurred === true);
      expect(codedPos.length).toBeGreaterThan(0);
      expect(codedPos.every((r) => typeof r.followUpDays === 'number')).toBe(true);
    });

    it('5.4 L0: Se/Sp ≈ answer key 注入值(分数据源分列,不合并)', () => {
      const perSiteSeSp: Array<{ site: string; se: number; sp: number }> = [];
      for (const site of ['demohospa', 'demohospb'] as const) {
        const st = siteTruth(truth, site);
        const m = confusionFromTruth(st);
        // 分列:各站独立对拍注入 Se/Sp(容许抽样波动)
        expect(m.sensitivity).toBeGreaterThan(params.codeSensitivity - 0.06);
        expect(m.sensitivity).toBeLessThan(params.codeSensitivity + 0.06);
        expect(m.specificity).toBeGreaterThan(params.codeSpecificity - 0.03);
        expect(m.specificity).toBeLessThan(params.codeSpecificity + 0.03);

        // 金标准路径:goldFromInjectedTruth(真值) vs 编码预测(算法)
        const gold = goldFromInjectedTruth(st);
        const preds = new Map<string, boolean>();
        for (const t of st) preds.set(t.subjectKey, t.codedPancreatitis);
        const { se, sp } = impliedSeSp(preds, gold);
        expect(se).toBeCloseTo(m.sensitivity, 10);
        expect(sp).toBeCloseTo(m.specificity, 10);
        perSiteSeSp.push({ site, se, sp });
      }
      // 分列不得合并成单一 Se/Sp 作为申报数字——两站各自保留
      expect(perSiteSeSp).toHaveLength(2);
      expect(perSiteSeSp[0].site).not.toBe(perSiteSeSp[1].site);
    });

    it('5.5 错分向零衰减:观测 OR < 注入 HR 是正确表现(非失败)', () => {
      // design D2: 非差异错分使观测效应向零衰减。断言「信号存在且方向对 +
      // 观测 OR 低于注入真 HR」,不断言 OR 精确等于 2.5。
      const observedOr = crudeOddsRatio(cellsFromRecords(records, params));
      expect(observedOr).toBeGreaterThan(1.3); // 信号存在、方向对
      expect(observedOr).toBeLessThan(params.trueHR); // 衰减是对的
      // answer key 仍记录注入真值,供对照——观测 ≠ 注入不代表管道坏了
      expect(params.trueHR).toBe(2.5);
      expect(answerKey.seed).toBeDefined();
    });

    it('6.5 负向:注入 HR=1 时观测 OR≈1(e2e 真在验复原,非恒过)', () => {
      // 同管道、无信号参数：若断言仍"总是 OR>1.3"则会红——证明正向用例不是空过。
      const { records: nullSignal } = injectSignal(
        syntheticBase(20000, ['demohospa']),
        { ...DEFAULT_INJECTION, trueHR: 1, zOddsRatio: 1 },
        7,
      );
      const or = crudeOddsRatio(cellsFromRecords(nullSignal, DEFAULT_INJECTION));
      expect(or).toBeGreaterThan(0.8);
      expect(or).toBeLessThan(1.25);
    });
  },
);
