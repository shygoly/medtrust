import { ServiceUnavailableException } from "@nestjs/common";

export interface SilkRoadSubject {
  subjectId: string;
  nodeId: string;
  orgName: string;
  uscc: string;
  region?: string;
  legalPerson?: string;
  rawPayload?: Record<string, unknown>;
}

export interface SilkRoadClient {
  listSubjects(): Promise<SilkRoadSubject[]>;
  pushCatalog(products: unknown[]): Promise<void>;
  reportAudit(digest: unknown): Promise<void>;
}

export function silkRoadNodeId(): string {
  return process.env.SILKROAD_NODE_ID?.trim() || "silk-road";
}

export function silkRoadConfigured(): boolean {
  return Boolean(process.env.SILKROAD_NODE_ENDPOINT?.trim());
}

// P2-2:丝路数港区域节点客户端抽象。真实接口文档(93 接口)到位后,
// 在 HttpSilkRoadClient 中按《数据基础设施接入指南》补齐身份互认/目录同步/
// 日志上报消息语义;当前开发环境返回 mock 主体,生产未配置 fail-closed。
export function createSilkRoadClient(): SilkRoadClient {
  const endpoint = process.env.SILKROAD_NODE_ENDPOINT?.trim();
  if (endpoint) return new HttpSilkRoadClient(endpoint);
  if (process.env.NODE_ENV === "production") {
    return new FailClosedSilkRoadClient();
  }
  return new DevSilkRoadClient();
}

class HttpSilkRoadClient implements SilkRoadClient {
  constructor(private readonly endpoint: string) {}

  async listSubjects(): Promise<SilkRoadSubject[]> {
    const res = await fetch(`${this.endpoint}/subjects`, {
      headers: { "X-Node-Id": silkRoadNodeId() },
    });
    if (!res.ok) {
      throw new ServiceUnavailableException("丝路数港节点主体同步失败");
    }
    const data = (await res.json()) as { subjects?: SilkRoadSubject[] };
    return data.subjects ?? [];
  }

  async pushCatalog(products: unknown[]): Promise<void> {
    const res = await fetch(`${this.endpoint}/catalog`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Node-Id": silkRoadNodeId(),
      },
      body: JSON.stringify({ products }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException("丝路数港节点目录同步失败");
    }
  }

  async reportAudit(digest: unknown): Promise<void> {
    const res = await fetch(`${this.endpoint}/audit-digest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Node-Id": silkRoadNodeId(),
      },
      body: JSON.stringify(digest),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException("丝路数港节点日志上报失败");
    }
  }
}

class FailClosedSilkRoadClient implements SilkRoadClient {
  private fail(): never {
    throw new ServiceUnavailableException(
      "丝路数港节点未配置(SILKROAD_NODE_ENDPOINT 为空),互认能力关闭",
    );
  }
  async listSubjects(): Promise<SilkRoadSubject[]> {
    return this.fail();
  }
  async pushCatalog(): Promise<void> {
    this.fail();
  }
  async reportAudit(): Promise<void> {
    this.fail();
  }
}

class DevSilkRoadClient implements SilkRoadClient {
  async listSubjects(): Promise<SilkRoadSubject[]> {
    // 开发联调 mock:与《数据基础设施接入指南》字段语义对齐,不代表真实数据。
    return [
      {
        subjectId: "sr-subj-001",
        nodeId: silkRoadNodeId(),
        orgName: "西安示例医院",
        uscc: "91610131MA6U000000",
        region: "陕西省/西安市",
        legalPerson: "张三",
        rawPayload: { registerType: "企事业单位法人", industry: "医疗卫生" },
      },
      {
        subjectId: "sr-subj-002",
        nodeId: silkRoadNodeId(),
        orgName: "陕西示例医药有限公司",
        uscc: "91610131MA6U111111",
        region: "陕西省/西安市",
        legalPerson: "李四",
        rawPayload: { registerType: "企业", industry: "医药研发" },
      },
    ];
  }
  async pushCatalog(products: unknown[]): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn(`[silk-road:dev] push catalog (${products.length} products)`);
  }
  async reportAudit(digest: unknown): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn(
      `[silk-road:dev] report audit digest: ${JSON.stringify(digest)}`,
    );
  }
}
