// omop-data-source-access —— 接入校验之后把覆盖元数据同步给目录（tasks 5.1 / 5.4）。
//
// 每次校验（启动 + 周期复核）都报一次：
//   · 过了 → 版本 + 库内统计；统计算不出来也照报版本（版本是新鲜的事实，目录据此判陈旧）；
//   · 没过 → 只报一个布尔，失败细节留在院内审计，不外传 schema / 关系名。
// 上报失败只记日志：目录同步不影响数据源在院内是否可用。
import { Injectable, Logger, Optional } from '@nestjs/common';
import { validateCoverageReport, type CdmCoverageReport } from '@medtrust/database';
import { ControlPlaneClient } from '../control-plane-client';
import type { AccessGateReport } from './cdm-access-gate';
import { computeCdmCoverage } from './cdm-coverage';
import type { CdmExecutor } from './cdm-executor';

@Injectable()
export class CdmCoverageReporter {
  private readonly logger = new Logger(CdmCoverageReporter.name);

  constructor(@Optional() private readonly controlPlane?: ControlPlaneClient) {}

  async buildReport(gate: AccessGateReport, executor: CdmExecutor): Promise<CdmCoverageReport> {
    if (!gate.passed) return { passed: false };
    let coverage = null;
    try {
      coverage = await computeCdmCoverage(executor);
    } catch (err) {
      this.logger.warn(`数据源 ${gate.label} 覆盖统计失败，只上报版本：${(err as Error).message}`);
    }
    return validateCoverageReport({
      passed: true,
      cdmVersion: gate.cdmVersion,
      vocabularyVersion: gate.vocabularyVersion,
      coverage,
    });
  }

  /** 产出并上报；返回实际发出的报文（便于审计与测试）。上报失败不抛。 */
  async publish(gate: AccessGateReport, executor: CdmExecutor): Promise<CdmCoverageReport | null> {
    let report: CdmCoverageReport;
    try {
      report = await this.buildReport(gate, executor);
    } catch (err) {
      this.logger.warn(`数据源 ${gate.label} 覆盖报文不合格，未上报：${(err as Error).message}`);
      return null;
    }
    if (!this.controlPlane) return report;
    try {
      await this.controlPlane.reportDataSourceCoverage(gate.label, report);
    } catch (err) {
      this.logger.warn(`数据源 ${gate.label} 覆盖元数据上报失败（下次复核重试）：${(err as Error).message}`);
    }
    return report;
  }
}
