/**
 * 组装关注点（Nest provider）：住在 `src/wiring/` 而不是基座目录 —— 它要把行业包声明的算子接线接到
 * 应用侧实现上，属**组装根区域**（change `kernel-stage-contract`：内核目录 MUST NOT import 行业包）。
 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { parseDataSourceDeclaration } from '@medtrust/database';
import { DataProductLocalSource } from '../domain/data-product-local-source';
import { LocalStore } from '../domain/local-store';
import { OutputGate } from '../domain/output-gate';
import { AlgorithmSandboxExecutor } from '../domain/sandbox/algorithm-sandbox-executor';
import { ConnectorModuleClient } from '../domain/sandbox/module-client';
import { sm3BytesHex } from '../domain/sm3';
import { canonicalSm3 } from '@medtrust/mdop';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { registerL15Operators, type ProportionalityBucket } from "@medtrust/domain-med";

/**
 * 把 L1.5 的四个算子接到现有实现上（任务 9.2–9.4）。
 *
 * 复用而不重写：数据加载与去标识化走 `DataProductLocalSource`/`LocalStore`，
 * 2×2 计数走**已登记的 wasm 模块 + 零能力沙箱**（`AlgorithmSandboxExecutor`），
 * 降密走既有 `OutputGate`（读合约 minCell，含二次抑制）。本模块只做接线与快照。
 */
@Injectable()
export class L15OperatorWiring implements OnModuleInit {
  private readonly logger = new Logger(L15OperatorWiring.name);

  constructor(
    private readonly executor: MdopStageExecutor,
    private readonly source: DataProductLocalSource,
    private readonly store: LocalStore,
    private readonly gate: OutputGate,
    @Optional() private readonly sandbox?: AlgorithmSandboxExecutor,
    @Optional() private readonly modules?: ConnectorModuleClient,
  ) {}

  onModuleInit(): void {
    registerL15Operators(
      this.executor,
      {
        ownsProduct: async (dataProductId) => {
          const declaration = await this.source.declarationFor(dataProductId);
          return declaration?.type !== 'series-file';
        },
        loadRows: async (dataProductId) => {
          // 同步解析器只查本地缓存；启动预热失败时按需向平台补拉一次（自愈）
          const product = await this.source.resolveProductAsync(dataProductId);
          if (!product) throw new Error(`无法解析数据产品元数据：${dataProductId}`);
          const result = this.source.loadFromProduct(product);
          this.logger.log(`MDOP 数据源载入 product=${dataProductId} rows=${result.records.length}`);
          return result.records;
        },
        snapshotOf: (dataProductId) => this.fileSnapshot(dataProductId),
        runProportionality: async (rows, drug, opts) => {
          if (!this.sandbox || !this.modules)
            throw new Error('本节点未接入 wasm 沙箱执行器（MDOP L1.5 需要它，fail-closed）');
          // 合约固定的模块摘要从阶段清单取（MDOP 语义下的 pinnedModule）
          const pinnedSm3 = String(opts.stage.stage.op_digest ?? '').replace(/^sm3:/, '');
          if (!/^[0-9a-f]{64}$/.test(pinnedSm3))
            throw new Error(`阶段没有可用的 wasm 模块摘要：${opts.stage.stage.op_digest}`);
          const {
            prepareDisproportionalityRows,
            projectDisproportionality,
          } = await import('../domain/sandbox/disproportionality-sandbox');
          const stageParams = (opts.stage.stage.params ?? {}) as Record<string, unknown>;
          const prepared = prepareDisproportionalityRows(rows, stageParams);
          const temporalWindow = stageParams.temporalWindow as
            | {
                maxDaysAfterStart?: number;
                allowSameDay?: boolean;
                requireTemporalOrder?: boolean;
              }
            | undefined;
          const projection = projectDisproportionality(
            prepared.rows,
            drug,
            undefined,
            temporalWindow,
          );
          const result = await this.sandbox.runProjection(projection, {
            pinnedModule: {
              analysisType: 'disproportionality',
              sm3: pinnedSm3,
            },
            taskId: opts.stage.jobId,
          });
          const buckets: ProportionalityBucket[] = result.buckets.map((b) => ({
            key: b.key,
            count: b.count,
            rate: b.rate,
            b: b.b,
            c: b.c,
            d: b.d,
          }));
          return {
            buckets,
            moduleSm3: result.moduleSm3,
            cohortSize: projection.cohortSize,
            ...(projection.temporalMode ? { temporalMode: projection.temporalMode } : {}),
          };
        },
        gate: (candidate, minCell, meta) =>
          this.gate.pass(candidate, minCell, {
            ...(meta?.contractId ? { contractId: meta.contractId } : {}),
          }) as unknown as Record<string, unknown>,
      },
      this.logger,
    );
    this.logger.log(`L1.5 算子已注册：${this.executor.registeredSystemOps().join(', ')}`);
  }

  /**
   * 文件数据源的快照标识 = **文件字节的 SM3**（§9.2）。
   * CDM 数据源本期不开放分析；取不到文件时返回 null，由调用方回退。
   */
  private fileSnapshot(dataProductId: string): string | null {
    try {
      const product = this.source.resolveProduct(dataProductId);
      if (!product) return null;
      const declaration = parseDataSourceDeclaration(product.fhirSchema);
      if (!declaration || declaration.type !== 'file') return null;
      const path = (declaration as { path?: string }).path;
      if (!path || !existsSync(path)) return null;
      return `sm3:${sm3BytesHex(new Uint8Array(readFileSync(path)))}`;
    } catch (err) {
      this.logger.warn(`快照标识计算失败（${dataProductId}）：${(err as Error).message}`);
      return null;
    }
  }

  /** 便于测试：把一段内存行当数据源（不落库）时的确定性快照。 */
  static rowsSnapshot(rows: readonly unknown[]): string {
    return canonicalSm3(rows);
  }
}
