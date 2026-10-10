import { Injectable } from "@nestjs/common";
import {
  ProxyMeteringProvider,
  contributionTotal,
  currentSpace,
} from "@medtrust/space-kernel";
import type {
  MeteringInput,
  MeteringMeasurement,
  MeteringProvider,
} from "@medtrust/space-kernel-spi";

/**
 * 计量口径解析（P3.1 / P3.3）。
 *
 * 按**空间**解析计量引擎：装载了算法口径（闭源 T2 插件）就用它，
 * 否则走开放兜底口径并在结果里如实标注 mode = proxy（D-SPD-7）。
 * 绝不静默假装已用算法口径。
 */
@Injectable()
export class MeteringService {
  private readonly fallback: MeteringProvider = new ProxyMeteringProvider();
  private readonly bySpace = new Map<string, MeteringProvider>();

  /** 装载某空间的计量引擎（由行业包或闭源插件注入）。 */
  use(spaceId: string, provider: MeteringProvider): void {
    this.bySpace.set(spaceId, provider);
  }

  providerFor(spaceId?: string): MeteringProvider {
    const key = spaceId ?? currentSpace()?.spaceId;
    return (key ? this.bySpace.get(key) : undefined) ?? this.fallback;
  }

  measure(
    input: MeteringInput,
    spaceId?: string,
  ): MeteringMeasurement | Promise<MeteringMeasurement> {
    const key = spaceId ?? currentSpace()?.spaceId ?? "";
    return this.providerFor(spaceId).measure({ spaceId: key }, input);
  }

  /** 对拍信息：贡献度合计 + 引擎标识/模式（供与算法口径对照，P3.3）。 */
  describe(measurement: MeteringMeasurement): {
    total: number;
    engine: string;
    mode: "authoritative" | "proxy";
  } {
    return {
      total: contributionTotal(measurement),
      engine: measurement.engine.id,
      mode: measurement.engine.mode,
    };
  }
}
