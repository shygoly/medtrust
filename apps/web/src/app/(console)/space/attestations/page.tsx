import { PageHeader, Panel } from "@/components/console/ui";
import { AttestationsLedger } from "./attestations-ledger";

export default function AttestationsPage() {
  return (
    <div>
      <PageHeader
        kicker="ATTESTATIONS · 存证账本"
        title="上链存证"
        desc="任务定义、授权策略、输出结果的哈希与指纹上链(ChainMaker)。链上不含任何医疗数据明文,仅作不可抵赖的审计凭据。"
      />
      <div className="p-8">
        <Panel ticks>
          <AttestationsLedger />
        </Panel>
      </div>
    </div>
  );
}
