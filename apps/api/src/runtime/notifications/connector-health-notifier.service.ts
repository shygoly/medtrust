import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CpConnectorRegistry } from "@medtrust/database";
import { DEFAULT_CONNECTOR_OFFLINE_MS } from "../participant-identity/connector-admin.service";
import { NotificationService } from "./notification.service";

/**
 * 连接器在线状态恢复/掉线提醒。
 * 只在状态**变化**时通知，避免每次心跳都刷一条。
 */
@Injectable()
export class ConnectorHealthNotifierService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConnectorHealthNotifierService.name);
  private timer?: ReturnType<typeof setInterval>;
  private readonly lastState = new Map<string, "online" | "offline">();

  constructor(
    @InjectRepository(CpConnectorRegistry, "controlplane")
    private readonly registry: Repository<CpConnectorRegistry>,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    if (!this.notifications) return;
    this.timer = setInterval(() => {
      void this.scan().catch((err) =>
        this.logger.warn(`连接器状态扫描失败：${(err as Error).message}`),
      );
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(now = new Date()): Promise<number> {
    if (!this.notifications) return 0;
    const threshold = Number(process.env.CONNECTOR_OFFLINE_MS ?? DEFAULT_CONNECTOR_OFFLINE_MS);
    const rows = await this.registry.find();
    let changed = 0;
    for (const row of rows) {
      const last = row.lastSeen ? new Date(row.lastSeen).getTime() : 0;
      const online = last > 0 && now.getTime() - last <= threshold;
      const state = online ? "online" : "offline";
      const previous = this.lastState.get(row.participantId);
      this.lastState.set(row.participantId, state);
      if (!previous) {
        // 首次扫描只记录状态：不在启动时给所有离线节点补发一轮历史告警。
        continue;
      }
      if (previous === state) continue;
      changed += 1;
      await this.notifications.notify({
        recipientParticipantId: row.participantId,
        spaceId: row.spaceId ?? null,
        type: `connector.${state}`,
        title: state === "offline" ? "连接器已离线" : "连接器已恢复在线",
        body:
          state === "offline"
            ? `连接器 ${row.participantId} 超过 ${Math.round(threshold / 1000)} 秒没有心跳，相关作业可能无法继续。`
            : `连接器 ${row.participantId} 已恢复心跳。`,
        resourceType: "connector",
        resourceId: row.participantId,
        details: { participantId: row.participantId, healthStatus: state },
      });
    }
    return changed;
  }
}
