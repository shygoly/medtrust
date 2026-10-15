import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CpConnectorRegistry,
  Certificate,
  MdopOperatorEntity,
  MdopOutboxEntity,
  MdopJobEntity,
  MdopAggregateContributionEntity,
  MdopFragmentEntity,
  MdopStageEntity,
  MdopTicketEntity,
  MdopSignatureRecordEntity,
  MdopHandleEntity,
  MdopDeliveryEntity,
  MdopReceiptEntity,
  MdopNonceEntity,
  MdopAttestationEntity,
  ModuleRevocationEntity,
  DigitalContractEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { ParticipantIdentityModule } from "../runtime/participant-identity/participant-identity.module";
import { ConnectorModulesModule } from "../runtime/connector-modules/connector-modules.module";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { MdopRevocationService } from "./revocation.service";
import { MdopJobsService } from "./mdop-jobs.service";
import { AggregateController } from "./scheduler/aggregate.controller";
import { AggregateSchedulerService } from "./scheduler/aggregate-scheduler.service";
import { MdopController } from "./mdop.controller";
import { MdopMessagesController } from "./mdop-messages.controller";
import { MdopOutboxService } from "./mdop-outbox.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopWitnessStatusService } from "./mdop-witness-status.service";
import { MdopAttestationService } from "./mdop-attestation.service";
import { DigitalContractModule } from "../runtime/digital-contract/digital-contract.module";

/**
 * MDOP 内核（控制面侧）——目前含算子注册中心与吊销名单签名。
 * 后续变更的编译器 / 凭证 / 调度器 / 投递也挂在这个模块下（apps/api/src/mdop/）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        MdopOperatorEntity,
        MdopOutboxEntity,
        MdopJobEntity,
        MdopAggregateContributionEntity,
        MdopFragmentEntity,
        MdopStageEntity,
        MdopTicketEntity,
        MdopSignatureRecordEntity,
        MdopHandleEntity,
        MdopDeliveryEntity,
        MdopReceiptEntity,
        MdopNonceEntity,
        MdopAttestationEntity,
        ModuleRevocationEntity,
        DigitalContractEntity,
        CpConnectorRegistry,
        // MdopTicketService / MdopMessagesController 要用证书仓储做按院验签
        Certificate,
      ],
      "controlplane",
    ),
    // 注册中心密钥 / 平台节点密钥都在 CaService（三钥分离）
    ParticipantIdentityModule,
    // wasm 算子摘要必须来自平台复现构建产物（D-CN-5）
    ConnectorModulesModule,
    // 编译期合约校验（持有方签名 / 生效状态 / 用途）复用 MDOP 合约服务
    DigitalContractModule,
  ],
  controllers: [MdopController, MdopMessagesController, AggregateController],
  providers: [
    GMCryptoService,
    MdopOperatorRegistryService,
    MdopRevocationService,
    MdopJobsService,
    MdopOutboxService,
    MdopTicketService,
    AggregateSchedulerService,
    MdopSchedulerService,
    MdopPurgeService,
    MdopReceiptChainService,
    MdopMergeService,
    MdopWitnessStatusService,
    /** 可信空间节点的证明登记（任务 5.1）：编译期放置与凭证冻结的依据。 */
    MdopAttestationService,
  ],
  exports: [
    MdopOperatorRegistryService,
    MdopRevocationService,
    MdopJobsService,
    MdopOutboxService,
    MdopTicketService,
    MdopSchedulerService,
    MdopPurgeService,
    MdopReceiptChainService,
    MdopMergeService,
    MdopWitnessStatusService,
    MdopAttestationService,
  ],
})
export class MdopModule {}
