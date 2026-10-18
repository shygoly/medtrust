import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  MdopDeliveryEntity,
  MdopFragmentEntity,
  MdopJobEntity,
  MdopStageEntity,
} from "@medtrust/database";
import {
  assertJobTransition,
  assertStageTransition,
  canonicalSm3,
  mergeReleaseManifests,
  releaseManifestOf,
  RELEASE_MANIFEST_KEY,
  withReleaseManifest,
  type JobState,
} from "@medtrust/mdop";
import { mergeProportionality } from "./operators/merge-disproportionality";
import { mergeFedAvg } from "./operators/merge-fedavg";
import {
  mergeLoraFedAvgSecure,
  type LoraSecureAggregateResult,
} from "./operators/merge-lora-secure";
import type { FlPartyRunResult } from "../compute-task/dto/fl-run-result";
import { kernelCollectorRegistry } from "./operators/collector-registry";
import { MdopPurgeService } from "./mdop-purge.service";

/**
 * 平台合并阶段（任务 7.7 执行侧 / 9.5）。
 *
 * 平台是合约明示的 C3 接收方（D-MDOP-2），所以合并只吃 C3 投递内容。
 * 收齐全部相关节点的投递后：按下发合并算子口径合并 → 结果作为 C3 交付物留存
 * → 作业走 `RELEASING → SUCCEEDED`（本期合约全部预授权自动放行）→ 触发销毁编排。
 */

export interface MergeOutcome {
  jobId: string;
  merged: boolean;
  nodes: string[];
  digest?: string;
}

@Injectable()
export class MdopMergeService {
  private readonly logger = new Logger(MdopMergeService.name);

  constructor(
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs: Repository<MdopJobEntity>,
    @InjectRepository(MdopDeliveryEntity, "controlplane")
    private readonly deliveries: Repository<MdopDeliveryEntity>,
    @InjectRepository(MdopFragmentEntity, "controlplane")
    private readonly fragments: Repository<MdopFragmentEntity>,
    @InjectRepository(MdopStageEntity, "controlplane")
    private readonly stages: Repository<MdopStageEntity>,
    private readonly purge: MdopPurgeService,
  ) {}

  /**
   * **应当投递 C3 的节点** = 片段里**产出 C3** 的节点（除平台外）。
   *
   * 为什么不是「所有片段持有方」：C2 场景里持有方只做 `source → seal`（C0→C2），
   * **C3 是可信空间节点出的**——若按「所有片段节点」收齐，平台会永远等两院的 C3，
   * 作业卡在 RUNNING（配对结果早就到了）。判据取阶段声明的输出等级：
   * 产出 C3 的节点才欠平台一份投递。
   */
  private async expectedNodes(jobId: string): Promise<string[]> {
    const platform = `urn:tds:${currentSpaceId()}:participant:platform`;
    const stages = await this.stages.find({ where: { jobId } });
    const c3Producers = new Set(
      stages.filter((s) => s.outputLabel === "C3").map((s) => s.node),
    );
    const nodes = (await this.fragments.find({ where: { jobId } }))
      .map((f) => f.node)
      .filter((node) => node !== platform && c3Producers.has(node));
    // 完全没有阶段记录的作业（历史行 / 只是片段的测试夹具）退回旧口径：
    // 「所有片段持有方都欠一份 C3」。有阶段记录时以「谁真的产出 C3」为准——
    // 这正是 C2 场景与 C0/C3 场景的差别所在。
    if (c3Producers.size === 0)
      return [
        ...new Set(
          (await this.fragments.find({ where: { jobId } }))
            .map((f) => f.node)
            .filter((node) => node !== platform),
        ),
      ].sort();
    return [...new Set(nodes)].sort();
  }

  /**
   * 收齐即合并。缺任一节点投递就返回 `merged:false`（等待重发，不提前合并）。
   * 幂等：平台侧合并结果以 `node=<platform>` 的一条投递记录留存，重复调用不会再算一遍。
   */
  async mergeIfReady(
    jobId: string,
    analysis: Parameters<typeof mergeProportionality>[0]["analysis"],
  ): Promise<MergeOutcome> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) throw new Error("作业不存在");
    const platform = `urn:tds:${currentSpaceId()}:participant:platform`;

    const existing = await this.deliveries.findOne({
      where: { jobId, node: platform },
    });
    if (existing)
      return { jobId, merged: true, nodes: [], digest: existing.digest };

    const nodes = await this.expectedNodes(jobId);
    const accepted = await this.deliveries.find({
      where: { jobId, accepted: true },
    });
    // 同一节点可能有多条已接受记录（重复投递/早期缺载荷的行）：**优先取带载荷的那条**，
    // 否则合并会以「投递没有 C3 载荷」失败，而载荷其实就在隔壁那一行。
    const byNode = new Map<string, (typeof accepted)[number]>();
    for (const row of accepted) {
      const prev = byNode.get(row.node);
      if (!prev || (!prev.payload && row.payload)) byNode.set(row.node, row);
    }
    const missing = nodes.filter((node) => !byNode.has(node));
    if (missing.length) {
      this.logger.debug(`作业 ${jobId} 尚缺投递：${missing.join(", ")}`);
      return { jobId, merged: false, nodes: missing };
    }

    const tables = nodes.map((node) => {
      const row = byNode.get(node)!;
      if (!row.payload)
        throw new Error(`节点 ${node} 的投递没有 C3 载荷，无法合并`);
      return { node, aggregate: row.payload as never };
    });
    // **按投递内容分派**，而不是假定一律失衡检测：跨院配对（`paired-cohort`）由可信空间节点
    // 在节点内算完，平台这一步是**收集**；拿失衡合并器去合它只会抛「只接受四格表」。
    // 判据取投递载荷自述的分析类型（这就是「实际算出来的是什么」的第一手事实）。
    const analysisTypes = new Set(
      tables.map(
        (t) => (t.aggregate as { analysisType?: string }).analysisType ?? "",
      ),
    );
    if (analysisTypes.size > 1)
      throw new Error(
        `各节点投递的分析类型不一致：${[...analysisTypes].join(", ")}`,
      );
    const deliveredType = [...analysisTypes][0];
    // 批次 1B（LoRA FedAvg）：节点间安全聚合的合并。各院本地解密并聚合后上传 C3，
    // 平台验证一致性（协议 v0.3 保证所有方得到相同的聚合结果）。
    const loraSecureStage = (
      (job.logicalPlan ?? {}) as {
        stages?: Array<{
          op?: string;
          params?: { spec?: unknown };
        }>;
      }
    ).stages?.find((s) => s.op?.startsWith("merge.fedavg-secure@"));

    // 批次 1A（mdop-fl-migration）：L4 联邦预测的合并。它的 per-node payload 是 FlPartyRunResult
    // （没有 analysisType），所以**按计划里的 merge.fedavg 阶段**分派，优先级在 analysisType 三元之前——
    // 否则会错落到 L1.5 的 mergeProportionality。合并口径复用旧链 mergeFlPartyResults（样本量加权）。
    const fedAvgStage = (
      (job.logicalPlan ?? {}) as {
        stages?: Array<{
          op?: string;
          params?: { spec?: unknown };
        }>;
      }
    ).stages?.find((s) => s.op?.startsWith("merge.fedavg@"));
    const merged = loraSecureStage
      ? mergeLoraFedAvgSecure({
          spec: loraSecureStage.params?.spec,
          parties: tables.map((t) => ({
            node: t.node,
            result: t.aggregate as unknown as LoraSecureAggregateResult,
          })),
        })
      : fedAvgStage
        ? mergeFedAvg({
            // 不透明透传：基座不做解释，也不 import 规格类型（解释与校验在非基座）。
            spec: fedAvgStage.params?.spec,
            parties: tables.map((t) => ({
              node: t.node,
              result: t.aggregate as unknown as FlPartyRunResult,
            })),
          })
        : (() => {
            // 行业口径经**注册表**解析（change pack-med-collectors / TD-12）：基座不 import 行业包，
            // 行业包在组装根注册。解析不到就按基座自有口径合并（失衡检测那条）；
            // 若载荷既无行业收集器、又不是四格表，mergeProportionality 会按自己的校验报错，不静默出结果。
            const collector = deliveredType
              ? kernelCollectorRegistry.resolve(deliveredType)
              : undefined;
            if (!collector) return mergeProportionality({ analysis, tables });
            // 合并阶段的参数**不透明透传**（基座不解释）：取计划的汇点阶段——没有任何阶段以它为输入的那个
            const mergedByCollector = collector.merge(
              { tables, params: sinkStageParams(job.logicalPlan) },
              { spaceId: currentSpaceId() },
            );
            return mergedByCollector as ReturnType<typeof mergeProportionality>;
          })();
    // 发布审查清单随合并结果一起交付（任务 7.3b）：各持有方各出一份，平台**汇总**，
    // 逐格明细不在这里（那些留在节点本地审查记录与回执里）。没有清单时按原样交付（不伪造）。
    const reports = tables
      .map((t) =>
        releaseManifestOf(t.aggregate as unknown as Record<string, unknown>),
      )
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    // 收集路径（paired-cohort、单一产出节点）**原样带回了节点那份清单** —— 那就用它，
    // 不要覆盖（`withReleaseManifest` 明确拒绝覆盖写）。只有「合并器重建了载荷」的情形
    // （失衡合并、或多节点收集后没有清单）才需要在这里汇总挂上。
    const alreadyHasManifest =
      (merged as unknown as Record<string, unknown>)[RELEASE_MANIFEST_KEY] !==
      undefined;
    if (alreadyHasManifest)
      // 已有清单就**解析一遍**（非法即抛，不静默放过），但不再写覆盖
      releaseManifestOf(merged as unknown as Record<string, unknown>);
    const delivered =
      reports.length > 0 && !alreadyHasManifest
        ? withReleaseManifest(
            merged as unknown as Record<string, unknown>,
            // 各方条目汇总成同一形状；单方作业就是退化情形（parties.length === 1）
            mergeReleaseManifests(reports.flatMap((r) => r.parties)),
          )
        : merged;
    const digest = canonicalSm3(delivered);
    await this.finishPlatformStages(jobId);
    await this.deliveries.save(
      this.deliveries.create({
        id: randomUUID(),
        jobId,
        node: platform,
        handle: `art://platform/${jobId}/merge/result`,
        label: "C3",
        digest,
        accepted: true,
        reason: null,
        payload: delivered as unknown as Record<string, unknown>,
      }),
    );

    // 本期合约全部预授权自动放行：合并落库即完成发布
    const from = job.status as JobState;
    if (from === "RUNNING") assertJobTransition(from, "RELEASING");
    if (job.status === "RUNNING") {
      await this.jobs.update(
        { id: jobId },
        { status: "RELEASING", updatedAt: new Date() },
      );
      assertJobTransition("RELEASING", "SUCCEEDED");
    }
    await this.jobs.update(
      { id: jobId },
      { status: "SUCCEEDED", updatedAt: new Date() },
    );
    this.logger.log(`作业 ${jobId} 合并完成（${nodes.length} 院）→ SUCCEEDED`);

    // 终态触发销毁编排（C3 交付物不销毁）
    await this.purge
      .orchestratePurge(jobId)
      .catch((err) =>
        this.logger.error(
          `销毁编排失败（作业 ${jobId}）：${(err as Error).message}`,
        ),
      );
    return { jobId, merged: true, nodes, digest };
  }

  /** 平台侧交付物（合并结果）。 */
  /**
   * 平台自己的阶段（合并）不经过消息调度，就地执行完要落状态：
   * 否则控制台里合并阶段永远停在 `PENDING`，与作业已 `SUCCEEDED` 自相矛盾。
   * 迁移按显式合法表走：`PENDING → READY → RUNNING → SUCCEEDED`。
   */
  private async finishPlatformStages(jobId: string): Promise<void> {
    const platform = `urn:tds:${currentSpaceId()}:participant:platform`;
    const rows = await this.stages.find({ where: { jobId, node: platform } });
    for (const row of rows) {
      if (row.status === "SUCCEEDED") continue;
      let status = row.status as string;
      const advance = async (to: string) => {
        assertStageTransition(status as never, to as never);
        status = to;
        await this.stages.update(
          { id: row.id },
          { status: to, updatedAt: new Date() },
        );
      };
      if (status === "PENDING") await advance("READY");
      if (status === "READY" || status === "RETRYING") await advance("RUNNING");
      if (status === "RUNNING") await advance("SUCCEEDED");
    }
  }

  async mergedResult(jobId: string): Promise<Record<string, unknown> | null> {
    const platform = `urn:tds:${currentSpaceId()}:participant:platform`;
    const row = await this.deliveries.findOne({
      where: { jobId, node: platform },
    });
    return (row?.payload as Record<string, unknown>) ?? null;
  }
}

/**
 * 逻辑计划**汇点阶段**（没有任何阶段以它为输入）的参数；汇点不唯一或没有参数时返回 undefined。
 * 汇点就是平台合并阶段：模板在这里放申请方的合并口径（目标、预算、阈值…），基座只搬运不解释。
 */
export function sinkStageParams(
  logicalPlan: unknown,
): Record<string, unknown> | undefined {
  const stages =
    (
      logicalPlan as {
        stages?: Array<{
          id?: string;
          inputs?: Array<{ from?: string }>;
          params?: Record<string, unknown>;
        }>;
      } | null
    )?.stages ?? [];
  const consumed = new Set(
    stages.flatMap((s) => (s.inputs ?? []).map((i) => i.from)),
  );
  const sinks = stages.filter((s) => s.id && !consumed.has(s.id));
  return sinks.length === 1 ? sinks[0]!.params : undefined;
}
