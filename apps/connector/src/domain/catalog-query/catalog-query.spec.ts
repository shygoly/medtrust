import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CatalogQueryService, toView } from './catalog-query.service';
import { CatalogQueryController } from './catalog-query.controller';

const product = {
  id: 'dp-1',
  providerId: 'p-demohospa',
  title: 'CKD 随访队列',
  // 故意塞进不该外露的字段，验证白名单会丢弃
  recordCount: 5000,
  patientRows: [{ subjectKey: 'x' }],
  fhirSchema: {
    profile: 'urn:medtrust:ckd-ehr-v1',
    fields: [
      { name: 'subjectKey', type: 'string', description: '受试者键' },
      { name: 'ageBand', type: 'string' },
      { bad: true },
    ],
    dataSource: { label: 'local-cdm' },
  },
};

function service(products: unknown[] = [product]) {
  return new CatalogQueryService({
    listCachedCatalogProducts: () => products,
  } as never);
}

describe('连接器只读目录（NDI-TR-2025-05 §7.2）', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('默认关闭：路由表现为 404（不是 401/500）', () => {
    delete process.env.CONNECTOR_CATALOG_SERVICE;
    expect(service().isEnabled()).toBe(false);
    expect(() => service().assertEnabled()).toThrow(NotFoundException);
  });

  it('开启后可检索与取详情', () => {
    process.env.CONNECTOR_CATALOG_SERVICE = 'on';
    const svc = service();
    expect(svc.list().total).toBe(1);
    expect(svc.list({ q: 'ckd' }).items[0].productId).toBe('dp-1');
    expect(svc.list({ q: 'nope' }).items).toHaveLength(0);
    expect(svc.get('dp-1').productId).toBe('dp-1');
    expect(() => svc.get('missing')).toThrow(NotFoundException);
  });

  it('字段白名单：不返回数据行、不返回精确记录数', () => {
    const view = toView(product as never);
    const json = JSON.stringify(view);
    expect(json).not.toContain('5000');
    expect(json).not.toContain('patientRows');
    expect(json).not.toContain('patientRows');
    expect(json).not.toContain('local-cdm');
    expect(view.fields?.map((f) => f.name)).toEqual(['subjectKey', 'ageBand']);
    expect(view.profile).toBe('urn:medtrust:ckd-ehr-v1');
  });

  it('对端白名单：配置后未登记对端被拒', () => {
    process.env.CONNECTOR_CATALOG_SERVICE = 'on';
    process.env.CONNECTOR_CATALOG_PEERS = 'p-a, p-b';
    const svc = service();
    expect(() => svc.assertPeerAllowed('p-a')).not.toThrow();
    expect(() => svc.assertPeerAllowed('p-c')).toThrow(ForbiddenException);
    delete process.env.CONNECTOR_CATALOG_PEERS;
    expect(() => svc.assertPeerAllowed('p-c')).not.toThrow();
  });

  it('分页钳制：limit 上限 100、下限 1', () => {
    process.env.CONNECTOR_CATALOG_SERVICE = 'on';
    const svc = service();
    expect(svc.list({ limit: 0 }).items).toHaveLength(1);
    expect(svc.list({ limit: 10_000 }).items).toHaveLength(1);
  });

  it('controller 关闭时抛 404（不进入业务查询）', () => {
    delete process.env.CONNECTOR_CATALOG_SERVICE;
    const controller = new CatalogQueryController(service());
    expect(() => controller.list({ connectorParticipantId: 'p-a' })).toThrow(NotFoundException);
  });

  it('controller 开启时按对端返回列表', () => {
    process.env.CONNECTOR_CATALOG_SERVICE = 'on';
    const controller = new CatalogQueryController(service());
    const result = controller.list({ connectorParticipantId: 'p-a' }, undefined, '10', '0');
    expect(result.total).toBe(1);
    expect(result.items[0].productId).toBe('dp-1');
  });
});
