// 降级检测：规格 vs 合约口径（design §7「规格与合约不一致 → 拒绝」）。
import type { DeidSpec } from '@medtrust/mdop';
import type { ContractView } from '../contract-view';
import {
  DeidDowngradeError,
  assertNoDowngrade,
  deidRequirementOf,
  type DeidContractRequirement,
} from './downgrade';

const spec = (): DeidSpec => ({
  version: 1,
  id: 'deid.ckd.v3',
  scope: { product: 'urn:tds:sp:ckd-cohort', level: 'C0_internal' },
  transforms: [
    { field: 'patientId', op: 'hmac_pseudonym', params: { saltRef: 'hosp-kms:ckd', outLen: 32 } },
    { field: 'name', op: 'drop' },
    { field: 'noteText', op: 'text_rules', params: { rules: ['phone', 'id_card', 'address', 'person_name'] } },
    { field: 'labValue', op: 'keep' },
  ],
  quasiIdentifierPolicy: { k: 5, suppressIfBelow: true, columns: ['ageBand', 'sex', 'region'] },
  denyIfTransformMissing: ['patientId', 'name'],
});

const requirement = (over: Partial<DeidContractRequirement> = {}): DeidContractRequirement => ({
  specId: 'deid.ckd.v3',
  productId: 'urn:tds:sp:ckd-cohort',
  maxLevel: 'C0_internal',
  mandatoryFields: ['patientId', 'name'],
  pseudonymFields: ['patientId'],
  minK: 5,
  textFields: ['noteText'],
  ...over,
});

const contract = (over: Partial<ContractView> = {}): ContractView => ({
  id: 'c-1',
  dataProductId: 'urn:tds:sp:ckd-cohort',
  purpose: 'rws',
  retention: '阅后即焚',
  output: '聚合',
  minCell: 5,
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  deid: { specId: 'deid.ckd.v3', pseudonymFields: ['patientId'], mandatoryFields: ['patientId', 'name'] },
  ...over,
});

describe('assertNoDowngrade', () => {
  it('口径一致 → 通过', () => {
    expect(() => assertNoDowngrade(spec(), requirement())).not.toThrow();
  });

  it('合约没绑规格条款 → 拒（不接受任何自选规格）', () => {
    expect(() => assertNoDowngrade(spec(), requirement({ specId: undefined }))).toThrow(
      DeidDowngradeError,
    );
  });

  it('拿别的规格顶替合约绑定的规格 → 拒', () => {
    expect(() => assertNoDowngrade(spec(), requirement({ specId: 'deid.other.v1' }))).toThrow(
      /CONTRACT_HAS_NO_DEID_BINDING/,
    );
  });

  it('数据产品不一致 → 拒', () => {
    expect(() => assertNoDowngrade(spec(), requirement({ productId: 'urn:tds:sp:other' }))).toThrow(
      /SPEC_PRODUCT_MISMATCH/,
    );
  });

  it('分级比合约更宽 → 拒', () => {
    const wide = { ...spec(), scope: { product: 'urn:tds:sp:ckd-cohort', level: 'C2' as const } };
    expect(() => assertNoDowngrade(wide, requirement({ maxLevel: 'C0_internal' }))).toThrow(
      /SPEC_LEVEL_TOO_PERMISSIVE/,
    );
  });

  it('把直接标识写成 keep（降级核心用例）→ 拒', () => {
    const downgraded = spec();
    downgraded.transforms = downgraded.transforms.map((t) =>
      t.field === 'patientId' ? { field: 'patientId', op: 'keep' } : t,
    );
    expect(() => assertNoDowngrade(downgraded, requirement())).toThrow(/DIRECT_IDENTIFIER_KEPT/);
  });

  it('合约要求的字段规格里根本没有 → 拒', () => {
    expect(() =>
      assertNoDowngrade(spec(), requirement({ mandatoryFields: ['patientId', 'name', 'phone'] })),
    ).toThrow(/MANDATORY_FIELD_NOT_TRANSFORMED/);
  });

  it('要求哈希加盐假名，规格只 drop → 拒', () => {
    const dropOnly = spec();
    dropOnly.transforms = dropOnly.transforms.map((t) =>
      t.field === 'patientId' ? { field: 'patientId', op: 'drop' } : t,
    );
    expect(() => assertNoDowngrade(dropOnly, requirement())).toThrow(
      /PSEUDONYM_REQUIRED_BUT_MISSING/,
    );
  });

  it('把 k 调到合约下限以下 → 拒', () => {
    const lowK = { ...spec(), quasiIdentifierPolicy: { k: 5, suppressIfBelow: true, columns: ['ageBand'] } };
    expect(() => assertNoDowngrade(lowK, requirement({ minK: 10 }))).toThrow(/K_BELOW_CONTRACT/);
  });

  it('省掉 quasiIdentifierPolicy（无法保证 k）→ 拒', () => {
    const noPolicy = { ...spec() };
    delete (noPolicy as { quasiIdentifierPolicy?: unknown }).quasiIdentifierPolicy;
    expect(() => assertNoDowngrade(noPolicy, requirement())).toThrow(/K_BELOW_CONTRACT/);
  });

  it('关掉小格抑制 → 拒', () => {
    const noSuppress = {
      ...spec(),
      quasiIdentifierPolicy: { k: 5, suppressIfBelow: false, columns: ['ageBand'] },
    };
    expect(() => assertNoDowngrade(noSuppress, requirement())).toThrow(
      /SMALL_CELL_SUPPRESSION_DISABLED/,
    );
  });

  it('合约要求自由文本去标识，规格没做 → 拒', () => {
    const noText = spec();
    noText.transforms = noText.transforms.filter((t) => t.field !== 'noteText');
    expect(() => assertNoDowngrade(noText, requirement())).toThrow(
      /TEXT_RULES_REQUIRED_BUT_MISSING/,
    );
  });
});

describe('deidRequirementOf', () => {
  it('合约没有 deid 条款 → null（agent 模式不接受）', () => {
    expect(deidRequirementOf(contract({ deid: undefined }))).toBeNull();
  });

  it('minK 缺省取合约 minCell / outputPolicy.minCell', () => {
    const view = contract({
      minCell: undefined,
      outputPolicy: { preset: 'aggregate_only', allowedArtifacts: [], minCell: 9, dp: { mode: 'none' } },
    });
    expect(deidRequirementOf(view)?.minK).toBe(9);
  });

  it('派生出的要求带上合约数据产品', () => {
    expect(deidRequirementOf(contract())?.productId).toBe('urn:tds:sp:ckd-cohort');
  });
});
