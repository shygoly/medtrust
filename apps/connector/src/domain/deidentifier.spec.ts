import { Deidentifier } from './deidentifier';
import { RawPatientRecord } from './types';

const raw: RawPatientRecord = {
  patientId: '310101199001011234',
  name: '张三',
  phone: '13812345678',
  birthDate: '1990-01-01',
  gender: 'male',
  conditions: ['高血压'],
  medications: ['注射用紫杉醇'],
  adverseEvents: [{ organSystem: '肝胆系统', term: 'ALT 升高', serious: false }],
};

describe('Deidentifier — 计算前本地脱敏', () => {
  const d = new Deidentifier();

  it('strips direct identifiers (name/phone/idCard/birthDate)', () => {
    const out = d.deidentify(raw);
    const json = JSON.stringify(out);
    expect(json).not.toContain('张三');
    expect(json).not.toContain('13812345678');
    expect(json).not.toContain('310101199001011234');
    expect(json).not.toContain('1990-01-01');
  });

  it('coarsens birthDate into an age band, keeps clinical fields', () => {
    const out = d.deidentify(raw);
    expect(out.ageBand).toMatch(/^\d+-\d+$/);
    expect(out.medications).toContain('注射用紫杉醇');
    expect(out.adverseEvents[0].organSystem).toBe('肝胆系统');
  });

  it('produces a stable pseudonymous subjectKey, not the real id', () => {
    const a = d.deidentify(raw);
    const b = d.deidentify(raw);
    expect(a.subjectKey).toBe(b.subjectKey);
    expect(a.subjectKey).not.toContain(raw.patientId);
  });

  it('containsDirectIdentifier flags raw, clears de-identified', () => {
    expect(d.containsDirectIdentifier(raw)).toBe(true);
    expect(d.containsDirectIdentifier(d.deidentify(raw))).toBe(false);
  });
});
