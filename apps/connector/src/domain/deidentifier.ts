import { Injectable } from '@nestjs/common';
import { RawPatientRecord, InternalRecord } from './types';
import { sm3Hex } from './sm3';

// 计算前本地脱敏 (data-space-connector spec). Strips direct identifiers before
// any record enters the local store or any computation. 假名化使用国密 SM3 + 每连接器盐。
@Injectable()
export class Deidentifier {
  private readonly DIRECT_IDENTIFIER_KEYS = ['patientId', 'name', 'phone', 'birthDate'] as const;

  deidentify(raw: RawPatientRecord, salt = 'connector-local-salt'): InternalRecord {
    return {
      subjectKey: this.pseudonym(raw.patientId, salt),
      ageBand: this.toAgeBand(raw.birthDate),
      sex: raw.gender,
      conditions: [...raw.conditions],
      medications: [...raw.medications],
      adverseEvents: raw.adverseEvents.map((e) => ({ ...e })),
      followUpDays: raw.followUpDays,
      eventOccurred: raw.eventOccurred,
    };
  }

  // Asserts an outgoing object carries none of the direct identifiers. Used by
  // the output path as a defensive check.
  containsDirectIdentifier(obj: unknown): boolean {
    const json = JSON.stringify(obj ?? {});
    return this.DIRECT_IDENTIFIER_KEYS.some((k) => json.includes(`"${k}"`));
  }

  private pseudonym(patientId: string, salt: string): string {
    return 'sk_' + sm3Hex(salt + ':' + patientId).slice(0, 16);
  }

  private toAgeBand(birthDate: string): string {
    const year = Number(birthDate.slice(0, 4));
    if (!year) return 'unknown';
    const age = new Date().getFullYear() - year;
    const lo = Math.floor(age / 10) * 10;
    return `${lo}-${lo + 9}`;
  }
}
