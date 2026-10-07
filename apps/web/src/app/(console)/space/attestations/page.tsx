import { PageHeader } from "@/components/console/ui";
import { AttestationsLedger } from "./attestations-ledger";

export default function AttestationsPage() {
  return (
    <div>
      <PageHeader
        kicker="ATTESTATIONS · 存证账本"
        desc="合约策略、计算结果、MDOP 审计回执链头与节点证明摘要的哈希上链(ChainMaker)。此处只列真实上链的记录;链上不含任何医疗数据明文,仅作不可抵赖的审计凭据。"
      />
      <div className="p-8">
        <AttestationsLedger />
      </div>
    </div>
  );
}
