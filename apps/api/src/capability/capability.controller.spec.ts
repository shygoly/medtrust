import { Test, TestingModule } from '@nestjs/testing';
import { LayerKind } from '@medtrust/database';
import { CapabilityController } from './capability.controller';
import { CapabilityRegistryService } from './registry.service';

describe('CapabilityController', () => {
  const svc = { list: jest.fn(), get: jest.fn() };
  let ctrl: CapabilityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CapabilityController],
      providers: [{ provide: CapabilityRegistryService, useValue: svc }],
    }).compile();
    ctrl = module.get(CapabilityController);
    jest.clearAllMocks();
  });

  it('GET /capability/:layer delegates to registry.list', async () => {
    svc.list.mockResolvedValue([{ key: 'tee-sgx' }]);
    await expect(ctrl.list(LayerKind.L6_PROTOCOL)).resolves.toEqual([{ key: 'tee-sgx' }]);
    expect(svc.list).toHaveBeenCalledWith(LayerKind.L6_PROTOCOL);
  });

  it('GET /capability/:layer/:key delegates to registry.get', async () => {
    svc.get.mockResolvedValue({ key: 'tee-sgx' });
    await expect(ctrl.get(LayerKind.L6_PROTOCOL, 'tee-sgx')).resolves.toEqual({ key: 'tee-sgx' });
    expect(svc.get).toHaveBeenCalledWith(LayerKind.L6_PROTOCOL, 'tee-sgx');
  });
});
