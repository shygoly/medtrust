import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  NotificationEntity,
  type NotificationStatus,
} from "@medtrust/database";
import { SpaceScopeService } from "../space-context/space-scope.service";
import { SpaceContextService } from "../space-context/space-context.service";
import { NotificationStreamService } from "./notification-stream.service";

/** 通知的对外形状（不含内部列）。 */
export interface NotificationView {
  id: string;
  recipientParticipantId: string;
  type: string;
  title: string;
  body?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actorParticipantId?: string | null;
  status: NotificationStatus;
  createdAt: string;
  readAt?: string | null;
  details?: Record<string, unknown> | null;
}

export interface NotificationInput {
  recipientParticipantId: string;
  /** 显式空间；后台任务不依赖请求上下文时必填。 */
  spaceId?: string | null;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  actorParticipantId?: string | null;
  recipientRole?: string;
  details?: Record<string, unknown>;
}

/**
 * 站内信（D-NOTIF-1）。
 *
 * 三条边界写死在这里：
 * 1. **只写站内信**：不假装发邮件/短信（本仓没有生产邮件通道）；
 * 2. **收件人是参与方**：机构待办，已读按参与方记；
 * 3. **通知不是闸门**：写入失败只告警，不影响动作本身（与审计同一策略）。
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(NotificationEntity, "controlplane")
    private readonly repo: Repository<NotificationEntity>,
    private readonly spaceScope: SpaceScopeService,
    private readonly spaceContext: SpaceContextService,
    @Optional()
    private readonly stream?: NotificationStreamService,
  ) {}

  /** 写一条站内信。**不抛**：通知失败不该让业务动作失败。 */
  async notify(input: NotificationInput): Promise<NotificationView | null> {
    if (!input.recipientParticipantId) return null;
    try {
      const spaceId =
        input.spaceId ?? this.spaceContext.current()?.spaceId ?? null;
      // 幂等：同一参与方、同一事件类型、同一资源只留一条。SSE/重试不会刷屏。
      if (input.resourceType && input.resourceId) {
        const existing = await this.repo.findOne({
          where: {
            recipientParticipantId: input.recipientParticipantId,
            type: input.type,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            ...(spaceId ? { spaceId } : {}),
          },
        });
        if (existing) return toView(existing);
      }
      const row = this.repo.create({
        id: randomUUID(),
        recipientParticipantId: input.recipientParticipantId,
        ...(input.recipientRole ? { recipientRole: input.recipientRole } : {}),
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        actorParticipantId: input.actorParticipantId ?? null,
        status: "unread" as NotificationStatus,
        details: input.details ?? null,
        spaceId,
      });
      const saved = await this.repo.save(row);
      this.stream?.publish({
        kind: "notification.created",
        participantId: saved.recipientParticipantId,
        spaceId: saved.spaceId ?? null,
        notificationId: saved.id,
      });
      return toView(saved);
    } catch {
      // 通知是旁路：写不进去也不改变主流程的结果（调用方照常继续）
      return null;
    }
  }

  /** 收件箱：只返回**发给该参与方**的通知（越权看不到别人的待办）。 */
  async list(query: {
    recipientParticipantId: string;
    status?: NotificationStatus;
    limit?: number;
  }): Promise<NotificationView[]> {
    if (!query.recipientParticipantId) return [];
    const qb = this.repo.createQueryBuilder("n");
    this.spaceScope.scope(qb, NotificationEntity.name);
    qb.andWhere("n.recipientParticipantId = :me", {
      me: query.recipientParticipantId,
    });
    if (query.status) qb.andWhere("n.status = :st", { st: query.status });
    qb.orderBy("n.createdAt", "DESC");
    qb.take(Math.min(Math.max(query.limit ?? 20, 1), 100));
    return (await qb.getMany()).map(toView);
  }

  async unreadCount(recipientParticipantId: string): Promise<number> {
    if (!recipientParticipantId) return 0;
    const qb = this.repo.createQueryBuilder("n");
    this.spaceScope.scope(qb, NotificationEntity.name);
    qb.andWhere("n.recipientParticipantId = :me", {
      me: recipientParticipantId,
    });
    qb.andWhere("n.status = :st", { st: "unread" });
    return qb.getCount();
  }

  /** 标记已读：只能标记发给自己的（别人的一律 404，不给探测空间）。 */
  async markRead(
    id: string,
    recipientParticipantId: string,
  ): Promise<NotificationView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || row.recipientParticipantId !== recipientParticipantId) {
      throw new NotFoundException("通知不存在");
    }
    if (row.status === "unread") {
      row.status = "read";
      row.readAt = new Date();
      await this.repo.save(row);
      this.stream?.publish({
        kind: "notification.read",
        participantId: row.recipientParticipantId,
        spaceId: row.spaceId ?? null,
        notificationId: row.id,
      });
    }
    return toView(row);
  }

  async markAllRead(
    recipientParticipantId: string,
  ): Promise<{ updated: number }> {
    if (!recipientParticipantId) return { updated: 0 };
    const result = await this.repo.update(
      { recipientParticipantId, status: "unread" },
      { status: "read", readAt: new Date() },
    );
    this.stream?.publish({
      kind: "notification.read-all",
      participantId: recipientParticipantId,
      spaceId: this.spaceContext.current()?.spaceId ?? null,
    });
    return { updated: result.affected ?? 0 };
  }

  /**
   * 把某资源上的待办标为已读（如申请被撤回后，医院那条「新的数据合约申请」不再需要处理）。
   *
   * `type` 可选：只清指定事件类型的待办；不传则清该资源下全部未读。
   * 不抛（与 notify 同一边界）：清理失败不能让撤回动作失败。
   */
  async markResolved(input: {
    recipientParticipantId: string;
    resourceType: string;
    resourceId: string;
    type?: string;
  }): Promise<{ updated: number }> {
    if (!input.recipientParticipantId) return { updated: 0 };
    try {
      const where: Record<string, unknown> = {
        recipientParticipantId: input.recipientParticipantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: "unread",
      };
      if (input.type) where.type = input.type;
      const result = await this.repo.update(where, {
        status: "read",
        readAt: new Date(),
      });
      if ((result.affected ?? 0) > 0) {
        this.stream?.publish({
          kind: "notification.read-all",
          participantId: input.recipientParticipantId,
          spaceId: this.spaceContext.current()?.spaceId ?? null,
        });
      }
      return { updated: result.affected ?? 0 };
    } catch {
      return { updated: 0 };
    }
  }
}

function toView(row: NotificationEntity): NotificationView {
  return {
    id: row.id,
    recipientParticipantId: row.recipientParticipantId,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    actorParticipantId: row.actorParticipantId ?? null,
    status: row.status,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : "",
    readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    details: row.details ?? null,
  };
}
