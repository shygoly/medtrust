import { SoftwareTee } from './tee';

describe('SoftwareTee — 软件机密计算 (5.1/5.2)', () => {
  let tee: SoftwareTee;
  beforeEach(() => {
    tee = new SoftwareTee();
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
    const other = new SoftwareTee();
    expect(() => other.run(sealed, (d) => d)).toThrow(); // GCM auth fails with a different key
  });

  it('attestation 如实标注 level=software (D9/D-RWS-4)', () => {
    const sealed = tee.seal({ v: 1 });
    const res = tee.run(sealed, (d) => d);
    expect((res.attestation as { level?: string }).level).toBe('software');
  });
});
