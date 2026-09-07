import { AuditService } from './audit';

describe('AuditService — 审计持久化 + 链式哈希(P0-6)', () => {
  it('records chained SM3 entries and produces a digest (in-memory)', () => {
    const audit = new AuditService(); // 无 repo → 内存态(兼容既有调用方)
    audit.record({ action: 'pep-deny', actor: 't1', allowed: false, detail: '目的不符' });
    audit.record({ action: 'output-block', actor: 't1', allowed: false, detail: '小格 n<5' });

    const entries = audit.all();
    expect(entries).toHaveLength(2);
    expect(entries[0].entryHash).toMatch(/^SM3:/);
    expect(entries[1].prevHash).toBe(entries[0].entryHash); // 链式 prevHash

    const d = audit.digest();
    expect(d.count).toBe(2);
    expect(d.firstPrevHash).toBe('GENESIS');
    expect(d.lastEntryHash).toBe(entries[1].entryHash);
    expect(audit.blocked()).toHaveLength(2);
  });

  it('persists entries via the optional repository (fire-and-forget)', () => {
    const saved: unknown[] = [];
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      create: (x: unknown) => x,
      save: jest.fn().mockImplementation(async (x: unknown) => {
        saved.push(x);
        return x;
      }),
    };
    const audit = new AuditService(repo as any);
    audit.record({ action: 'raw-read-blocked', actor: 'ext', allowed: false });
    expect(repo.save).toHaveBeenCalled();
    const row = repo.save.mock.calls[0][0] as any;
    expect(row.entryHash).toMatch(/^SM3:/);
    expect(row.prevHash).toBe('GENESIS');
  });

  it('restores entries + chain tail on module init (restart persistence)', async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([
        { action: 'pep-deny', actor: 't1', allowed: false, detail: 'x', at: new Date(), entryHash: 'SM3:a', prevHash: 'GENESIS' },
        { action: 'output-block', actor: 't1', allowed: false, detail: 'y', at: new Date(), entryHash: 'SM3:b', prevHash: 'SM3:a' },
      ]),
      create: (x: unknown) => x,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const audit = new AuditService(repo as any);
    await audit.onModuleInit();
    expect(audit.all()).toHaveLength(2);
    const d = audit.digest();
    expect(d.lastEntryHash).toBe('SM3:b');
    // 链尾接续:下一条的 prevHash 应为 SM3:b
    audit.record({ action: 'x', actor: 'internal', allowed: true });
    expect(audit.all()[2].prevHash).toBe('SM3:b');
  });
});
