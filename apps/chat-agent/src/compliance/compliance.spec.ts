import type { ContractSummary } from '../agent/tools/api-client';
import { FakeApiClient, FAKE_USABLE_CONTRACT } from '../test-utils/fake-api-client';
import {
  checkContractGate,
  checkDataAccess,
  checkMembership,
  collectDataProducts,
  collectParticipants,
  evaluateContract,
  evaluateContractSet,
  evaluatePrerequisites,
  submissionPurpose,
} from './compliance';

const contract = (over: Partial<ContractSummary> = {}): ContractSummary => ({
  ...FAKE_USABLE_CONTRACT,
  ...over,
});

const input = { participants: ['p-sponsor', 'p-hosp-a'] };

describe('合规判定：镜像控制面 assertUsableForJob 的五条判据', () => {
  it('合约存在 + 持有方签名 + active + 未过期 + 用途相符 → usable', () => {
    expect(evaluateContract(contract(), input)).toEqual({
      status: 'usable',
      contractId: 'ct-fake-1',
      contractStatus: 'active',
    });
  });

  it('未签名 → not-usable，且给出"等对方签发"的下一步（不是泛泛报错）', () => {
    const gate = evaluateContract(contract({ holderSigned: false }), input);
    expect(gate).toMatchObject({ status: 'not-usable', fix: 'await_provider_approval' });
    expect(gate?.reason).toContain('E_CONTRACT_UNSIGNED');
  });

  it('MDOP 状态非 active → not-usable（区分业务 status 与 mdopStatus）', () => {
    const gate = evaluateContract(contract({ mdopStatus: 'terminated' }), input);
    expect(gate).toMatchObject({ status: 'not-usable', fix: 'await_provider_approval' });
    expect(gate?.reason).toContain('terminated');
  });

  it('已过期 → not-usable，建议重新申请', () => {
    const gate = evaluateContract(contract({ validUntil: '2020-01-01T00:00:00.000Z' }), input);
    expect(gate).toMatchObject({ status: 'not-usable', fix: 'request_contract' });
    expect(gate?.reason).toContain('过期');
  });

  it('用途编码不符 → not-usable 并点明 E_PURPOSE_MISMATCH', () => {
    // 用途编码只在合约**声明了** purposeCode 时才有可比对象；
    // 默认桩刻意不带 purposeCode（未知不拦），这里显式给一个不符的编码。
    const gate = evaluateContract(contract({ purposeCode: 'rws.cohort-count' }), {
      ...input,
      purpose: 'mdop.external-control',
    });
    expect(gate).toMatchObject({ status: 'not-usable', fix: 'request_contract' });
    expect(gate?.reason).toContain('E_PURPOSE_MISMATCH');
  });

  it('不覆盖全部参与方 → 不参与判定（返回 null）', () => {
    expect(evaluateContract(contract(), { participants: ['p-sponsor', 'p-grid-a'] })).toBeNull();
  });
});

describe('合约闸 / 成员 / 前置条件', () => {
  it('多数据源按「提供方 + 数据产品」各匹配一份合约，不要求单合约覆盖全部参与方', async () => {
    const api = new FakeApiClient({
      contracts: [
        contract({
          id: 'ct-a',
          providerId: 'p-demohospa',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-a',
          purposeCode: 'mdop.external-control',
        }),
        contract({
          id: 'ct-b',
          providerId: 'p-demohospb',
          consumerId: 'pharma-demo',
          dataProductId: 'dp-b',
          purposeCode: 'mdop.external-control',
        }),
      ],
    });
    const gate = await checkContractGate(api, 'tk', {
      participants: ['p-demohospa', 'p-demohospb'],
      purpose: 'mdop.external-control',
      requirements: [
        { participantId: 'p-demohospa', dataProductId: 'dp-a' },
        { participantId: 'p-demohospb', dataProductId: 'dp-b' },
      ],
    });
    expect(gate).toMatchObject({
      status: 'usable',
      contractIds: ['ct-a', 'ct-b'],
      allocations: [
        { participantId: 'p-demohospa', dataProductId: 'dp-a', contractId: 'ct-a' },
        { participantId: 'p-demohospb', dataProductId: 'dp-b', contractId: 'ct-b' },
      ],
    });
  });

  it('多数据源缺一侧合约 → missing，并点名缺哪个数据源', () => {
    const gate = evaluateContractSet(
      [
        contract({
          id: 'ct-a',
          providerId: 'p-demohospa',
          dataProductId: 'dp-a',
          purposeCode: 'mdop.external-control',
        }),
      ],
      {
        participants: ['p-demohospa', 'p-demohospb'],
        purpose: 'mdop.external-control',
        requirements: [
          { participantId: 'p-demohospa', dataProductId: 'dp-a' },
          { participantId: 'p-demohospb', dataProductId: 'dp-b' },
        ],
      },
    );
    expect(gate).toMatchObject({ status: 'missing', fix: 'request_contract' });
    expect(gate.reason).toContain('p-demohospb/dp-b');
  });

  it('多份合约里挑出可用的那一份', async () => {
    const api = new FakeApiClient({
      contracts: [
        contract({ id: 'ct-old', holderSigned: false }),
        contract({ id: 'ct-new' }),
      ],
    });
    await expect(checkContractGate(api, 'tk', input)).resolves.toMatchObject({
      status: 'usable',
      contractId: 'ct-new',
    });
  });

  it('没有覆盖双方的合约 → missing + 建议发起申请', async () => {
    const api = new FakeApiClient({ contracts: [] });
    const gate = await checkContractGate(api, 'tk', input);
    expect(gate).toMatchObject({ status: 'missing', fix: 'request_contract' });
    expect(gate.reason).toContain('E_CONTRACT_MISSING');
  });

  it('查询失败 / 无凭证 → unknown（**不拦**：查询故障 ≠ 无权限，强制点在控制面）', async () => {
    await expect(
      checkContractGate(new FakeApiClient({ complianceFailWith: 'ECONNREFUSED' }), 'tk', input),
    ).resolves.toMatchObject({ status: 'unknown' });
    await expect(checkContractGate(new FakeApiClient(), undefined, input)).resolves.toMatchObject({
      status: 'unknown',
    });
  });

  it('待签发的草稿也是候选：报"等提供方签发"而不是"没有合约"（可跟踪申请进度）', async () => {
    const api = new FakeApiClient({
      contracts: [{ ...FAKE_USABLE_CONTRACT, id: 'ct-draft', status: 'draft', holderSigned: false }],
    });
    await expect(checkContractGate(api, 'tk', input)).resolves.toMatchObject({
      status: 'not-usable',
      contractId: 'ct-draft',
      contractStatus: 'draft',
      fix: 'await_provider_approval',
    });
  });

  it('成员检查：属于 / 不属于 / 查询失败', async () => {
    await expect(checkMembership(new FakeApiClient(), 'tk', 'sh-med')).resolves.toMatchObject({
      status: 'yes',
      role: 'consumer',
    });
    await expect(checkMembership(new FakeApiClient(), 'tk', 'hn-power')).resolves.toMatchObject({
      status: 'no',
    });
    await expect(
      checkMembership(new FakeApiClient({ complianceFailWith: 'boom' }), 'tk', 'sh-med'),
    ).resolves.toMatchObject({ status: 'unknown' });
  });

  it('登录态失效（401）→ 确定性拒绝，提示重新登录（不按"查不动"放行）', async () => {
    const api = new FakeApiClient({ complianceUnauthorized: true });
    await expect(
      evaluatePrerequisites(api, { token: 'expired', spaceId: 'sh-med', ...input }),
    ).resolves.toMatchObject({ status: 'needs_permission' });
    const verdict = await evaluatePrerequisites(api, { token: 'expired', spaceId: 'sh-med', ...input });
    expect(verdict.reason).toContain('重新登录');
  });

  it('合约查询遇到 401 → unknown 但带"登录态已失效"原因（不再是泛泛的查询失败）', async () => {
    const api = new FakeApiClient({ complianceUnauthorized: true });
    const gate = await checkContractGate(api, 'expired', input);
    expect(gate).toMatchObject({ status: 'unknown' });
    expect(gate.reason).toContain('登录态已失效');
  });

  it('前置条件汇总：ready / needs_contract / needs_permission', async () => {
    await expect(
      evaluatePrerequisites(new FakeApiClient(), { token: 'tk', spaceId: 'sh-med', ...input }),
    ).resolves.toMatchObject({ status: 'ready', contractId: 'ct-fake-1' });

    await expect(
      evaluatePrerequisites(new FakeApiClient({ contracts: [] }), {
        token: 'tk',
        spaceId: 'sh-med',
        ...input,
      }),
    ).resolves.toMatchObject({ status: 'needs_contract' });

    await expect(
      evaluatePrerequisites(new FakeApiClient(), { token: 'tk', spaceId: 'hn-power', ...input }),
    ).resolves.toMatchObject({ status: 'needs_permission' });
  });

  it('前置条件汇总：访问授权被拒 → needs_data_access（先于合约判定，且不误报成合约问题）', async () => {
    const api = new FakeApiClient({ dataAccess: {} });
    await expect(
      evaluatePrerequisites(api, {
        token: 'tk',
        spaceId: 'sh-med',
        ...input,
        dataProductIds: ['dp-controls'],
      }),
    ).resolves.toMatchObject({
      status: 'needs_data_access',
      fix: 'request_data_access',
      dataAccess: { status: 'denied', dataProductId: 'dp-controls' },
    });
  });

  it('前置条件汇总：授权通过仍要看合约（ACL 不替代合约）', async () => {
    const api = new FakeApiClient({ contracts: [] });
    await expect(
      evaluatePrerequisites(api, {
        token: 'tk',
        spaceId: 'sh-med',
        ...input,
        dataProductIds: ['dp-controls'],
      }),
    ).resolves.toMatchObject({ status: 'needs_contract' });
  });
});

describe('产品级访问授权（ACL，D-ACL-1）', () => {
  it('已授权 → allowed；授权表里没有该产品 → denied 并给出可读原因', async () => {
    await expect(
      checkDataAccess(new FakeApiClient(), 'tk', ['dp-controls'], 'mdop.external-control'),
    ).resolves.toMatchObject({ status: 'allowed' });

    const denied = await checkDataAccess(new FakeApiClient({ dataAccess: {} }), 'tk', ['dp-controls']);
    expect(denied).toMatchObject({ status: 'denied', dataProductId: 'dp-controls' });
    expect(denied?.reason).toContain('还没有授权给你所在的参与方');
  });

  it('被拒原因逐条翻译成人话（回收原因也带出来）', async () => {
    const denied = await checkDataAccess(
      new FakeApiClient({
        dataAccess: {
          'dp-controls': {
            allowed: false,
            reason: 'revoked',
            dataProductId: 'dp-controls',
            participantId: 'p-sponsor',
            providerId: 'p-hosp-a',
            permissions: [],
            revokeReason: '合作项目结束',
          },
        },
      }),
      'tk',
      ['dp-controls'],
    );
    expect(denied?.reason).toContain('已被提供方回收');
    expect(denied?.reason).toContain('合作项目结束');
  });

  it('没有数据产品入参 / 没有调用者凭证 → 不做判定（返回 null，不拦）', async () => {
    await expect(checkDataAccess(new FakeApiClient(), 'tk', [])).resolves.toBeNull();
    await expect(checkDataAccess(new FakeApiClient(), undefined, ['dp-controls'])).resolves.toBeNull();
  });

  it('查询故障（端点未部署/网络） → unknown，**不拦**（强制点在控制面）', async () => {
    await expect(
      checkDataAccess(new FakeApiClient({ dataAccess: 'fail' }), 'tk', ['dp-controls']),
    ).resolves.toMatchObject({ status: 'unknown', dataProductId: 'dp-controls' });
  });
});

describe('载荷提取辅助', () => {
  it('collectParticipants 深度受限地收集参与方（direct 与 template 形状都能取）', () => {
    expect(
      collectParticipants({ payload: { trial: { participantId: 'p-a' }, controls: { participantId: 'p-b' } } }),
    ).toEqual(['p-a', 'p-b']);
    expect(
      collectParticipants({ templateInput: { participants: [{ participantId: 'p-a' }] } }),
    ).toEqual(['p-a']);
    // 深度上限 5：真的更深的（7 层）不收，避免误扫无关结构
    expect(
      collectParticipants({ l1: { l2: { l3: { l4: { l5: { l6: { l7: { participantId: 'too-deep' } } } } } } } }),
    ).toEqual([]);
    expect(collectParticipants(null)).toEqual([]);
  });

  it('submissionPurpose 取 payload 里的 purpose（控制面就是拿它比对的）', () => {
    expect(submissionPurpose({ payload: { purpose: 'rws.external-control' } })).toBe('rws.external-control');
    expect(submissionPurpose({ templateInput: { purpose: 'power.load-forecast' } })).toBe('power.load-forecast');
    expect(submissionPurpose({})).toBeUndefined();
  });

  it('collectDataProducts 认两种形态：以 DataProduct 结尾的字段 + dataProducts 数组/多值串', () => {
    expect(
      collectDataProducts({
        payload: { trial: { dataProductId: 'dp-trial' }, controlsDataProduct: 'dp-controls' },
      }),
    ).toEqual(['dp-trial', 'dp-controls']);
    expect(
      collectDataProducts({ templateInput: { dataProducts: 'dp-a, dp-b' } }),
    ).toEqual(['dp-a', 'dp-b']);
    expect(collectDataProducts({ templateInput: { dataProducts: [{ id: 'dp-object' }] } })).toEqual([]);
    expect(collectDataProducts(null)).toEqual([]);
  });
});
