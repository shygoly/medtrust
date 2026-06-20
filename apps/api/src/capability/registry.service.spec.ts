import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  LayerKind,
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';

describe('CapabilityRegistryService', () => {
  const l3 = { find: jest.fn(), findOne: jest.fn() };
  const noop = { find: jest.fn(), findOne: jest.fn() };
  let svc: CapabilityRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityRegistryService,
        { provide: getRepositoryToken(L1Scenario), useValue: noop },
        { provide: getRepositoryToken(L3Model), useValue: l3 },
        { provide: getRepositoryToken(L4Algorithm), useValue: noop },
        { provide: getRepositoryToken(L5Operator), useValue: noop },
        { provide: getRepositoryToken(L6Protocol), useValue: noop },
        { provide: getRepositoryToken(L7Infrastructure), useValue: noop },
      ],
    }).compile();
    svc = module.get(CapabilityRegistryService);
    jest.clearAllMocks();
  });

  it('lists a known layer', async () => {
    l3.find.mockResolvedValue([{ key: 'meditron-7b' }]);
    await expect(svc.list(LayerKind.L3_MODEL)).resolves.toEqual([{ key: 'meditron-7b' }]);
    expect(l3.find).toHaveBeenCalledTimes(1);
  });

  it('gets by key', async () => {
    l3.findOne.mockResolvedValue({ key: 'meditron-7b' });
    await expect(svc.get(LayerKind.L3_MODEL, 'meditron-7b')).resolves.toEqual({ key: 'meditron-7b' });
    expect(l3.findOne).toHaveBeenCalledWith({ where: { key: 'meditron-7b' } });
  });

  it('rejects an unknown / non-readable layer (fail-closed)', () => {
    expect(() => svc.list('nope' as LayerKind)).toThrow();
    // L2 不在 P0 只读集合内
    expect(() => svc.list(LayerKind.L2_COMPLIANCE)).toThrow();
  });
});
