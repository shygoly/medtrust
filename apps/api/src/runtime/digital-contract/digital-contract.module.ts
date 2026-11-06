import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AttestationRef,
  Certificate,
  DigitalContractEntity,
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
  MdopAttestationEntity,
  MdopJobEntity,
  MdopOutboxEntity,
  MdopReceiptEntity,
  ParticipantIdentity,
  RwsAssignmentEntity,
  RwsTaskEntity,
  User,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CatalogModule } from "../catalog/catalog.module";
import { BlockchainModule } from "../../blockchain/blockchain.module";
import { ContractService } from "./contract.service";
import { AttestationService } from "./attestation.service";
import { ContractController } from "./contract.controller";
import { ConnectorModulesModule } from "../connector-modules/connector-modules.module";
import { ComplianceModule } from "../../capability/l2-compliance/compliance.module";
import { DataAccessModule } from "../data-access/data-access.module";
import { AuditModule } from "../../audit/audit.module";
import { NotificationModule } from "../notifications/notification.module";
import { ParticipantIdentityModule } from "../participant-identity/participant-identity.module";
import { MdopContractService } from "./mdop-contract.service";
import { AttestationLedgerService } from "./attestation-ledger.service";
import { AttestationLedgerBackfillService } from "./attestation-ledger-backfill.service";
import { AttestationLedgerController } from "./attestation-ledger.controller";

// 数字合约 + 使用控制(控制面侧):合约生成、生效状态、撤销、哈希上链存证。
// 持久化在 control-plane 库。
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        DigitalContractEntity,
        Certificate,
        MdopOutboxEntity,
        // 存证指针账本:指针表本身 + 判定「谁有权看」与历史回填要读的各域记录(只读)。
        AttestationRef,
        RwsTaskEntity,
        RwsAssignmentEntity,
        FlPredictionTaskEntity,
        FlPredictionAssignmentEntity,
        MdopJobEntity,
        MdopReceiptEntity,
        MdopAttestationEntity,
        // contract-review：机构显示名（按 slug 查 org）。
        ParticipantIdentity,
      ],
      "controlplane",
    ),
    // contract-review：申请人/审批人姓名快照（默认连接上的 users 表）。
    TypeOrmModule.forFeature([User]),
    CatalogModule,
    BlockchainModule,
    // algorithm-sandbox:固定模块条款须校验 SM3 在平台模块注册表内
    ConnectorModulesModule,
    // D-CMP-2:合约申请重裁决 + 种子合约挂预审快照
    ComplianceModule,
    // D-MDOP-4:合约持有方签署流程要用 CA（验签/副署/公钥指纹）
    ParticipantIdentityModule,
    // D-ACL-1：预授权自动推进要用产品级授权判定
    DataAccessModule,
    // D-MDOP-9：自动推进是平台侧动作，写平台审计链
    AuditModule,
    // D-NOTIF-1：合约申请/审批结果要进机构收件箱
    NotificationModule,
  ],
  controllers: [ContractController, AttestationLedgerController],
  providers: [
    GMCryptoService,
    ContractService,
    AttestationLedgerService,
    AttestationLedgerBackfillService,
    AttestationService,
    MdopContractService,
  ],
  exports: [
    ContractService,
    AttestationService,
    AttestationLedgerService,
    MdopContractService,
  ],
})
export class DigitalContractModule {}
