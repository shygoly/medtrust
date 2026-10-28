import { Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { DigitalContractEntity, MdopJobEntity } from "@medtrust/database";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { NotificationService } from "../runtime/notifications/notification.service";

export type MdopTerminalKind = "succeeded" | "failed" | "rejected";

/**
 * MDOP 作业终态通知：只发终态，不发 RUNNING。
 * 收件人取任务引用合约的提供方与使用方并集；去重由 NotificationService 按
 * (recipient, type, resourceType, resourceId) 保证。
 */
@Injectable()
export class MdopJobNotifierService {
  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async notifyTerminal(
    jobId: string,
    kind: MdopTerminalKind,
    reason?: string,
  ): Promise<void> {
    if (!this.notifications) return;
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) return;
    const contracts = job.contracts?.length
      ? await this.contracts.find({ where: { id: In(job.contracts) } })
      : [];
    const recipients = new Set<string>();
    for (const contract of contracts) {
      if (contract.providerId) recipients.add(contract.providerId);
      if (contract.consumerId) recipients.add(contract.consumerId);
    }
    if (recipients.size === 0) return;

    const title =
      kind === "succeeded"
        ? "计算作业已完成"
        : kind === "failed"
          ? "计算作业失败"
          : "计算作业被拒绝";
    const body =
      kind === "succeeded"
        ? `作业 ${job.id} 已完成合并，可查看结果。`
        : `作业 ${job.id} ${kind === "failed" ? "执行失败" : "提交被拒绝"}${reason ? `：${reason}` : ""}`;
    for (const recipientParticipantId of recipients) {
      await this.notifications.notify({
        recipientParticipantId,
        spaceId: job.spaceId ?? currentSpaceId(),
        type: `mdop.job.${kind}`,
        title,
        body,
        resourceType: "mdop-job",
        resourceId: job.id,
        actorParticipantId: null,
        details: {
          jobId: job.id,
          status: job.status,
          ...(reason ? { reason } : {}),
        },
      });
    }
  }
}
