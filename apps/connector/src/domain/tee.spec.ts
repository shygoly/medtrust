import { SoftwareSealedCompute } from './tee';
import { Test } from '@nestjs/testing';
import { AuditService } from './audit';

describe('SoftwareSealedCompute — 软件机密计算 (5.1/5.2)', () => {
  let tee: SoftwareSealedCompute;
  beforeEach(() => {
    tee = new SoftwareSealedCompute();
  });

  it('sealed input does not reveal the plaintext', () => {
    const secret = { patientId: '310101199001011234', value: 42 };
    const sealed = tee.seal(secret);
    expect(sealed.ciphertext).not.toContain('310101199001011234');
    expect(JSON.stringify(sealed)).not.toContain('310101199001011234');
  });

  it('runs the function in-enclave and returns only the output', () => {
    const rows = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const sealed = tee.seal(rows);
    const res = tee.run<number>(sealed, (data: { v: number }[]) => data.reduce((s, r) => s + r.v, 0));
    expect(res.output).toBe(6);
    expect(res.attestation.enclave).toBe(tee.enclaveId);
    // the result exposes no decrypted rows
    expect(JSON.stringify(res)).not.toContain('"v"');
  });

  it('another enclave cannot open this enclave\'s sealed data (key never leaves)', () => {
    const sealed = tee.seal({ secret: 'xyz' });
    const other = new SoftwareSealedCompute();
    expect(() => other.run(sealed, (d) => d)).toThrow(); // GCM auth fails with a different key
  });

  it('attestation 如实标注 level=software (D9/D-RWS-4)', () => {
    const sealed = tee.seal({ v: 1 });
    const res = tee.run(sealed, (d) => d);
    expect((res.attestation as { level?: string }).level).toBe('software');
  });

  it('如实标注无隔离:isolation=none (CTL-09)', () => {
    const res = tee.run(tee.seal({ v: 1 }), (d) => d);
    expect(res.attestation.isolation).toBe('none');
  });

  it('measurement 是分析函数源码的 SM3,而非随机标签', () => {
    const sumFn = (d: { v: number }[]) => d.reduce((s, r) => s + r.v, 0);
    const a = tee.run(tee.seal([{ v: 1 }]), sumFn).attestation.measurement;
    const t2 = new SoftwareSealedCompute();
    const again = t2.run(t2.seal([{ v: 2 }]), sumFn);
    const other = tee.run(tee.seal([{ v: 1 }]), (d: unknown[]) => d.length).attestation.measurement;
    expect(a).toMatch(/^sm3:[0-9a-f]{64}$/);
    expect(again.attestation.measurement).toBe(a); // 同一段代码 → 同一指纹,与实例无关
    expect(other).not.toBe(a); // 换了代码 → 指纹不同
  });

  it('Nest 装配时审计服务注入 SoftwareSealedCompute 单例(三个执行器共用它)', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [AuditService, SoftwareSealedCompute] }).compile();
    const wired = moduleRef.get(SoftwareSealedCompute);
    wired.run(wired.seal({ v: 1 }), (d) => d);
    expect(moduleRef.get(AuditService).all().some((e) => e.action === 'tee-run')).toBe(true);
  });

  it('每次运行写入本地审计,不再丢弃证明', () => {
    const audit = new AuditService();
    const audited = new SoftwareSealedCompute(audit);
    const res = audited.run(audited.seal({ v: 1 }), (d) => d);
    const entry = audit.all().find((e) => e.action === 'tee-run');
    expect(entry?.allowed).toBe(true);
    expect(entry?.detail).toContain('level=software');
    expect(entry?.detail).toContain('isolation=none');
    expect(entry?.detail).toContain(res.attestation.measurement);
  });

  describe('生产判据下不可实例化（T3 / D9 / CTL-09）', () => {
    const withNodeEnv = (value: string | undefined, fn: () => void | Promise<void>) => {
      const prev = process.env.NODE_ENV;
      if (value === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = value;
      const restore = () => {
        if (prev === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev;
      };
      try {
        const out = fn();
        return out && typeof (out as Promise<void>).then === 'function'
          ? (out as Promise<void>).finally(restore)
          : (restore(), out);
      } catch (err) {
        restore();
        throw err;
      }
    };

    it('NODE_ENV=production 时构造必须抛错，并写明无隔离/无远程证明与 D9/CTL-09', () => {
      withNodeEnv('production', () => {
        expect(() => new SoftwareSealedCompute()).toThrow(/无隔离/);
        expect(() => new SoftwareSealedCompute()).toThrow(/无远程证明/);
        expect(() => new SoftwareSealedCompute()).toThrow(/D9/);
        expect(() => new SoftwareSealedCompute()).toThrow(/CTL-09/);
        expect(() => new SoftwareSealedCompute()).toThrow(/C2/);
      });
    });

    it('NODE_ENV 大小写与空白不影响生产判据（与 tee-node 对齐）', () => {
      withNodeEnv(' Production ', () => {
        expect(() => new SoftwareSealedCompute()).toThrow(/D9/);
      });
    });

    it('开发判据下仍可实例化（Jest 默认 NODE_ENV=test）', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(() => new SoftwareSealedCompute()).not.toThrow();
    });

    it('NODE_ENV=development 或未设置时仍可实例化（demo / 本地连接器）', () => {
      withNodeEnv('development', () => {
        expect(() => new SoftwareSealedCompute()).not.toThrow();
      });
      withNodeEnv(undefined, () => {
        expect(() => new SoftwareSealedCompute()).not.toThrow();
      });
    });

    it('生产判据下 Nest 装配 SoftwareSealedCompute 必须失败（不得静默注入软件实现）', async () => {
      await withNodeEnv('production', async () => {
        await expect(Test.createTestingModule({ providers: [SoftwareSealedCompute] }).compile()).rejects.toThrow(
          /D9|CTL-09/,
        );
      });
    });
  });
});
