import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  LayerKind,
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';

describe('CapabilityRegistryService', () => {
  const l3 = {
    find: jest.fn(), findOne: jest.fn(),
    create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: 'id-1', ...x })),
    merge: jest.fn((a, b) => ({ ...a, ...b })), remove: jest.fn(async () => undefined),
  };
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

  describe('create', () => {
    it('creates a new object when key is free', async () => {
      l3.findOne.mockResolvedValue(null);
      const dto = { key: 'my-model', name: 'My Model', category: 'LLM' };
      await svc.create(LayerKind.L3_MODEL, dto);
      expect(l3.create).toHaveBeenCalledWith(dto);
      expect(l3.save).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate key (conflict)', async () => {
      l3.findOne.mockResolvedValue({ key: 'meditron-7b' });
      await expect(
        svc.create(LayerKind.L3_MODEL, { key: 'meditron-7b', name: 'X', category: 'LLM' }),
      ).rejects.toThrow();
      expect(l3.save).not.toHaveBeenCalled();
    });

    it('rejects missing layer-required field (L3 category)', async () => {
      await expect(
        svc.create(LayerKind.L3_MODEL, { key: 'k', name: 'n' }),
      ).rejects.toThrow(/category/);
    });

    it('rejects missing key', async () => {
      await expect(svc.create(LayerKind.L3_MODEL, { name: 'n', category: 'LLM' })).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('merges into an existing object, key immutable', async () => {
      l3.findOne.mockResolvedValue({ key: 'meditron-7b', name: 'old' });
      await svc.update(LayerKind.L3_MODEL, 'meditron-7b', { key: 'hacked', name: 'new' });
      const merged = l3.merge.mock.calls[0][1];
      expect(merged.key).toBeUndefined(); // key 被剔除
      expect(merged.name).toBe('new');
      expect(l3.save).toHaveBeenCalledTimes(1);
    });

    it('throws NotFound for missing key', async () => {
      l3.findOne.mockResolvedValue(null);
      await expect(svc.update(LayerKind.L3_MODEL, 'ghost', { name: 'x' })).rejects.toThrow();
    });
  });

  describe('remove', () => {
    it('removes an existing object', async () => {
      l3.findOne.mockResolvedValue({ key: 'meditron-7b' });
      await expect(svc.remove(LayerKind.L3_MODEL, 'meditron-7b')).resolves.toEqual({ deleted: true, key: 'meditron-7b' });
      expect(l3.remove).toHaveBeenCalledTimes(1);
    });

    it('throws NotFound for missing key', async () => {
      l3.findOne.mockResolvedValue(null);
      await expect(svc.remove(LayerKind.L3_MODEL, 'ghost')).rejects.toThrow();
    });
  });
});
