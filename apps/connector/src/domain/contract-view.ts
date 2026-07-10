// The connector's view of a digital contract, received from the control plane
// over the wire (JSON). The connector enforces it but does not author it; the
// authoritative DigitalContract lives in the control plane (@medtrust/database).
import { RwsAnalysisLevel, RwsArtifactKind } from './types';

export type ContractStatus = 'draft' | 'active' | 'expired' | 'revoked';

export interface Pricing {
  model: "per-record" | "per-task" | "subscription";
  amount: number;
  currency: string;
}

export interface ContractView {
  id: string;
  dataProductId?: string;
  purpose: string; // 目的限定
  retention: string; // 留存约束,如 阅后即焚
  output: string; // 输出约束
  allowedLevels?: RwsAnalysisLevel[]; // 分析分级授权(rws-analytics-ladder);未声明=不限制
  allowedArtifacts?: RwsArtifactKind[]; // 出域产物白名单;未声明=不限制
  validUntil: string; // ISO
  status: ContractStatus;
  pricing?: Pricing; // 计价条款(value-settlement);无则不结算
  providerId?: string;
  consumerId?: string;
}
