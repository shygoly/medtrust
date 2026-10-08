import {
  dedupCohortProjection,
  veRegistryProjection,
  veTestProjection,
} from './seal';

/**
 * 三个新场景的最小投影（C2 封装阶段在**数据持有方本地**做的事）。
 *
 * 这些测试守的是一条红线：**白名单外的字段不出机构**，且持有方该做的本地归一化
 * （检测去重、罕见病编码过滤）必须在这里完成，不能指望节点内再补。
 */
describe('VE(TND) 与跨院去重的封存投影', () => {
  describe('ve-registry（疾控侧接种记录）', () => {
    const upstream = {
      productId: 'dp-ve-immunization-cdc',
      snapshot: 'snap-1',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '40-64',
          sex: 'F',
          immunizations: [
            { code: '208', date: '2022-01-10', doseNo: 1 },
            { code: '140', date: '2022-03-01', doseNo: 1 }, // 白名单外（非 mRNA）
            { code: '208', date: '2022-02-01', doseNo: 2 },
          ],
        },
        { ageBand: '40-64', sex: 'M', immunizations: [{ code: '208', date: '2022-01-10' }] }, // 无 linkKey
      ],
    };

    it('只封白名单内疫苗，一剂一行，带剂次与分层键；无 linkKey 的记录不出院', () => {
      const out = veRegistryProjection(upstream, ['207', '208']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        { subjectKey: 'lk-1', vaccinationDate: '2022-01-10', vaccineCode: '208', doseNo: 1, ageBand: '40-64', sex: 'F' },
        { subjectKey: 'lk-1', vaccinationDate: '2022-02-01', vaccineCode: '208', doseNo: 2, ageBand: '40-64', sex: 'F' },
      ]);
      expect(JSON.stringify(out)).not.toContain('140'); // 白名单外疫苗码不得出现
    });
  });

  describe('ve-tests（医院侧检测记录）', () => {
    const upstream = {
      productId: 'dp-ve-tests-hospital',
      snapshot: 'snap-2',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '40-64',
          sex: 'F',
          tests: [
            { code: '94500-6', date: '2022-05-01', result: 'pos' },
            { code: '94500-6', date: '2022-05-01', result: 'neg' }, // 同人同日重复：只留首条
            { code: '94500-6', date: '2022-06-01', result: 'neg' },
            { code: '99999-9', date: '2022-07-01', result: 'pos' }, // 白名单外病原
          ],
        },
        { linkKey: '', tests: [] }, // 空假名
      ],
    };

    it('只封白名单内病原，并按 (linkKey, 检测日期) 去重（首条胜）', () => {
      const out = veTestProjection(upstream, ['94500-6']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        { subjectKey: 'lk-1', testDate: '2022-05-01', pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'F' },
        { subjectKey: 'lk-1', testDate: '2022-06-01', pathogenCode: '94500-6', result: 'neg', ageBand: '40-64', sex: 'F' },
      ]);
      expect(JSON.stringify(out)).not.toContain('99999-9');
    });

    it('只封明确的阳性 / 阴性：不确定、缺失或其它写法的结果不出院，也不挤掉当日的有效结果', () => {
      const out = veTestProjection(
        {
          productId: 'dp-ve-tests-hospital',
          snapshot: 'snap-3',
          rows: [
            {
              linkKey: 'lk-2',
              ageBand: '40-64',
              sex: 'M',
              tests: [
                { code: '94500-6', date: '2022-05-01', result: 'inconclusive' }, // 先出现的不确定结果
                { code: '94500-6', date: '2022-05-01', result: 'pos' }, // 同日的有效结果要留下
                { code: '94500-6', date: '2022-05-02', result: 'POS' }, // 写法不对
                { code: '94500-6', date: '2022-05-03' }, // 缺结果
              ],
            },
          ],
        },
        ['94500-6'],
      );
      expect(out.rows).toEqual([
        { subjectKey: 'lk-2', testDate: '2022-05-01', pathogenCode: '94500-6', result: 'pos', ageBand: '40-64', sex: 'M' },
      ]);
    });
  });

  describe('dedup-cohort（跨院队列）', () => {
    const upstream = {
      productId: 'dp-dedup-cohort-a',
      snapshot: 'snap-3',
      rows: [
        {
          linkKey: 'lk-1',
          ageBand: '65+',
          sex: 'F',
          observation: { start: '2021-01-01', end: '2022-12-31' },
          events: [
            { code: 'I21.9', date: '2022-03-03' },
            { code: 'J10.1', date: '2022-04-04' }, // 白名单外诊断
          ],
          rareDisease: { code: 'E76.0', firstDate: '2022-05-05' },
        },
        {
          linkKey: 'lk-2',
          observation: { start: '2021-06-01', end: '2022-06-01' },
          events: [],
          rareDisease: { code: 'X99.9', firstDate: '2022-01-01' }, // 白名单外罕见病
        },
        { linkKey: 'lk-3', events: [] }, // 无观察期 → 不封
      ],
    };

    it('只封白名单内编码；无观察期或无假名的记录不出院；罕见病按白名单置 null', () => {
      const out = dedupCohortProjection(upstream, ['I21.9'], ['E76.0']);
      expect(out.n).toBe(2);
      expect(out.rows).toEqual([
        {
          subjectKey: 'lk-1',
          ageBand: '65+',
          sex: 'F',
          observation: { start: '2021-01-01', end: '2022-12-31' },
          events: [{ code: 'I21.9', date: '2022-03-03' }],
          rareDisease: { code: 'E76.0', firstDate: '2022-05-05' },
        },
        {
          subjectKey: 'lk-2',
          observation: { start: '2021-06-01', end: '2022-06-01' },
          events: [],
          rareDisease: null,
        },
      ]);
      expect(JSON.stringify(out)).not.toContain('J10.1');
      expect(JSON.stringify(out)).not.toContain('X99.9');
    });
  });
});
