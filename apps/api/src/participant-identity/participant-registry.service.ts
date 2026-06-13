import { Injectable } from '@nestjs/common';
import { CaService, Certificate } from './ca.service';

export interface ParticipantAdmission {
  org: string;
  subjectVerified: boolean; // 主体认证
  dataVerified: boolean; // 数据资源认证
}

export interface DatasetForAuthorization {
  title: string;
  rightsConfirmed: boolean; // 确权
  classification?: string; // 分级分类标签
}

export class AdmissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdmissionDeniedError';
  }
}

// 准入与授权门禁(participant-identity spec)。
@Injectable()
export class ParticipantRegistryService {
  constructor(private readonly ca: CaService) {}

  // 2.2 / 2.6: 仅接受本 CA 签发且有效(未吊销/未过期)的连接器证书。
  registerConnector(cert: Certificate): void {
    const r = this.ca.verify(cert);
    if (!r.valid) throw new AdmissionDeniedError(`连接器接入被拒:${r.reason}`);
  }

  // 2.4: 主体+数据双认证,缺一不可。
  admit(p: ParticipantAdmission): void {
    if (!p.subjectVerified) throw new AdmissionDeniedError('准入被拒:主体身份未认证');
    if (!p.dataVerified) throw new AdmissionDeniedError('准入被拒:数据资源未认证');
  }

  // 2.5: 先确权再授权,且必须已分级分类。
  authorizeDataset(d: DatasetForAuthorization): void {
    if (!d.rightsConfirmed) throw new AdmissionDeniedError('授权被拒:数据未确权');
    if (!d.classification) throw new AdmissionDeniedError('授权被拒:数据未分级分类');
  }

  // 2.6: 每次任务交互前校验证书仍有效(吊销后即被拒)。
  assertCanInteract(cert: Certificate): void {
    const r = this.ca.verify(cert);
    if (!r.valid) throw new AdmissionDeniedError(`任务交互被拒:${r.reason}`);
  }
}
