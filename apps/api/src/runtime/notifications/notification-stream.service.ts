import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export type NotificationStreamKind =
  "notification.created" | "notification.read" | "notification.read-all";

export interface NotificationStreamEvent {
  kind: NotificationStreamKind;
  /** 收件参与方：只有同一个参与方连接能收到。 */
  participantId: string;
  /** 空间：null/undefined 的旧数据对所有空间可见（与 list 的 scope 兼容）。 */
  spaceId?: string | null;
  notificationId?: string;
}

/**
 * 进程内通知事件总线（SSE 用）。
 *
 * 单实例部署足够；多实例部署需要换成 Redis/Postgres LISTEN/NOTIFY，
 * 但接口保持"按参与方 + 空间过滤"不变。
 */
@Injectable()
export class NotificationStreamService {
  private readonly events = new Subject<NotificationStreamEvent>();

  publish(event: NotificationStreamEvent): void {
    this.events.next(event);
  }

  forParticipant(
    participantId: string,
    spaceId?: string | null,
  ): Observable<NotificationStreamEvent> {
    return new Observable((subscriber) => {
      const subscription = this.events.subscribe((event) => {
        if (event.participantId !== participantId) return;
        if (event.spaceId && spaceId && event.spaceId !== spaceId) return;
        subscriber.next(event);
      });
      return () => subscription.unsubscribe();
    });
  }
}
