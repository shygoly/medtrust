// 角色化工作台：按当前角色算出「现在该处理什么」——每项是一个计数加一个直达链接。
// 纯函数；计数全部来自与落点页面相同的数据。某个来源读取失败（undefined）时计数为 null，
// 界面显示「—」，不以 0 冒充。

import { taskListHref, type TaskRow } from "./task-list";

export interface WorkItem {
  key: string;
  label: string;
  /** null = 该来源读取失败或尚未返回。 */
  count: number | null;
  hint: string;
  href: string;
  tone: "cyan" | "green" | "amber" | "red";
}

export interface WorkbenchSources {
  tasks?: TaskRow[];
  contracts?: Array<{ status?: string; providerId?: string; consumerId?: string }>;
  alerts?: Array<{ kind: { severity: string } }>;
  breaches?: Array<{ status: string }>;
  /** 待审的机构认证申请数。 */
  pendingCertifications?: number;
  /**
   * 未读站内信数（D-NOTIF-1）。收件人是参与方，所以每个有参与方身份的角色都有这个待办。
   * undefined = 读取失败/未返回 → 显示「—」（不拿 0 冒充）。
   */
  unreadNotifications?: number;
}

const countOf = <T,>(list: T[] | undefined, test: (item: T) => boolean): number | null =>
  list ? list.filter(test).length : null;

export function buildWorkbench(
  role: string | undefined,
  participantId: string | undefined,
  sources: WorkbenchSources,
): WorkItem[] {
  const { tasks, contracts, alerts, breaches } = sources;
  // 站内信是**机构待办**：所有已绑定参与方的角色都该看到自己机构的未读（provider/consumer/compliance/operator）。
  const inbox: WorkItem = {
    key: "unread-notifications",
    label: "未读通知",
    count: sources.unreadNotifications ?? null,
    hint: "合约申请/审批结果等机构待办",
    href: "/space#notifications",
    tone: "amber",
  };
  // 合约 draft = 使用方已申请、等提供方签发。
  const draftContracts = (side: "providerId" | "consumerId") =>
    countOf(contracts, (c) => c.status === "draft" && !!participantId && c[side] === participantId);

  const oversight: WorkItem[] = [
    {
      key: "high-alerts",
      label: "高危告警",
      count: countOf(alerts, (a) => a.kind.severity === "high"),
      hint: "审计日志中识别出的高危操作",
      href: "/space/audit?view=alerts",
      tone: "red",
    },
    {
      key: "open-breaches",
      label: "开放的 QTL 越限",
      count: countOf(breaches, (b) => b.status === "open"),
      hint: "待确认的质量容差越限",
      href: "/space/rbqm",
      tone: "amber",
    },
  ];

  switch (role) {
    case "provider":
      return [
        inbox,
        {
          key: "inbound-running",
          label: "本院执行中的任务",
          count: countOf(tasks, (t) => t.myRole === "provider" && t.badge === "running"),
          hint: "分派给本院、尚未回传",
          href: taskListHref({ role: "provider", status: "running" }),
          tone: "cyan",
        },
        {
          key: "inbound-blocked",
          label: "本院执行受阻",
          count: countOf(tasks, (t) => t.myRole === "provider" && t.badge === "blocked"),
          hint: "执行失败或被拦截，需排查",
          href: taskListHref({ role: "provider", status: "blocked" }),
          tone: "red",
        },
        {
          key: "contracts-to-issue",
          label: "待本院签发的合约",
          count: draftContracts("providerId"),
          hint: "使用方已提交申请",
          href: "/space/contracts",
          tone: "amber",
        },
      ];
    case "consumer":
      return [
        inbox,
        {
          key: "mine-running",
          label: "进行中的任务",
          count: countOf(tasks, (t) => t.myRole === "initiator" && t.badge === "running"),
          hint: "我发起、尚未出结果",
          href: taskListHref({ role: "initiator", status: "running" }),
          tone: "cyan",
        },
        {
          key: "mine-blocked",
          label: "受阻的任务",
          count: countOf(tasks, (t) => t.myRole === "initiator" && t.badge === "blocked"),
          hint: "失败、被拒或部分完成",
          href: taskListHref({ role: "initiator", status: "blocked" }),
          tone: "red",
        },
        {
          key: "mine-completed",
          label: "已完成、可查看结果",
          count: countOf(tasks, (t) => t.myRole === "initiator" && t.badge === "completed"),
          hint: "结果、交付物与存证已就绪",
          href: taskListHref({ role: "initiator", status: "completed" }),
          tone: "green",
        },
        {
          key: "contracts-pending",
          label: "待提供方签发的合约",
          count: draftContracts("consumerId"),
          hint: "已申请、等待医院签发",
          href: "/space/contracts",
          tone: "amber",
        },
      ];
    case "compliance":
      return [...oversight, inbox];
    case "operator":
      return [
        ...oversight,
        inbox,
        {
          key: "pending-certifications",
          label: "待审的机构认证",
          count: sources.pendingCertifications ?? null,
          hint: "自注册用户提交的认证申请",
          href: "/space/admin/certifications",
          tone: "amber",
        },
      ];
    default:
      // admin 与未分配角色：产品里没有面向它们的待办来源。
      return [];
  }
}
