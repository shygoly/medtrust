import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash } from "crypto";
import {
  AttestationRef,
  AuditAction,
  DigitalContractEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { AuditService } from "./audit.service";
import { buildZip } from "./zip.util";

export interface EvidencePackage {
  zip: Buffer;
  fingerprint: string;
  fileCount: number;
}

// P2-5:审计证据包。聚合审计报告(JSON+HTML 可打印 PDF)、存证指针、
// 数字合约快照,全部文件做 SM3 摘要并生成 manifest 与证据包指纹。
// 合规/运营导出,离线可出示、可归档、可验。
@Injectable()
export class EvidencePackageService {
  constructor(
    private readonly auditService: AuditService,
    private readonly gm: GMCryptoService,
    @InjectRepository(AttestationRef, "controlplane")
    private readonly attestations: Repository<AttestationRef>,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
  ) {}

  async build(query: {
    tenantId: number;
    action?: AuditAction;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<EvidencePackage> {
    const limit = query.limit ?? 200;
    const report = await this.auditService.exportReport(query);

    const attestationRows = await this.attestations.find({
      order: { at: "DESC" },
      take: limit,
    });
    const contractRows = await this.contracts.find({
      order: { createdAt: "DESC" },
      take: limit,
    });

    const html = this.renderHtml(report, attestationRows, contractRows);

    const files: Array<{ name: string; data: Buffer }> = [
      { name: "report.html", data: Buffer.from(html, "utf8") },
      {
        name: "report.json",
        data: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
      },
      {
        name: "attestations.json",
        data: Buffer.from(JSON.stringify(attestationRows, null, 2), "utf8"),
      },
      {
        name: "contracts.json",
        data: Buffer.from(JSON.stringify(contractRows, null, 2), "utf8"),
      },
    ];

    const fileDigests = files.map((f) => ({
      name: f.name,
      size: f.data.length,
      sm3: this.gm.sm3Hash(f.data.toString("utf8")),
      sha256: createHash("sha256").update(f.data).digest("hex"),
    }));
    const packageFingerprint = this.gm.sm3Hash(JSON.stringify(fileDigests));

    const manifest = {
      package: "MedTrust 审计证据包",
      generatedAt: new Date().toISOString(),
      tenantId: query.tenantId,
      packageFingerprint,
      files: fileDigests,
    };
    files.push({
      name: "manifest.json",
      data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    });

    const zip = buildZip(files);
    return { zip, fingerprint: packageFingerprint, fileCount: files.length };
  }

  private renderHtml(
    report: Record<string, unknown>,
    attestations: AttestationRef[],
    contracts: DigitalContractEntity[],
  ): string {
    const entries = (report.entries as Array<Record<string, unknown>>) ?? [];
    const integrity = report.integrity as Record<string, unknown>;
    const rows = entries
      .map(
        (e) => `<tr>
          <td>${this.esc(e.timestamp)}</td>
          <td>${this.esc(e.action)}</td>
          <td>${this.esc(e.resourceType)}${e.resourceId ? ` #${this.esc(e.resourceId)}` : ""}</td>
          <td>${this.esc(e.userName ?? e.userId ?? "-")}</td>
          <td class="mono">${this.esc(e.entryHash ?? "-")}</td>
        </tr>`,
      )
      .join("");
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>MedTrust 审计报告</title>
<style>
body{font-family:-apple-system,"PingFang SC",sans-serif;margin:32px;color:#111}
h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px}
h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}
th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f8fafc}
.mono{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;background:#dcfce7;color:#166534;font-size:12px}
.badge.bad{background:#fee2e2;color:#991b1b}
</style></head><body>
<h1>MedTrust 审计报告</h1>
<p>生成时间:${this.esc(report.generatedAt)} · 租户:${this.esc(report.tenantId ?? "-")}</p>
<p>完整性校验:<span class="badge ${integrity.ok ? "" : "bad"}">${this.esc(integrity.message ?? "-")}(检查 ${integrity.checked ?? 0} 条)</span></p>
<h2>筛选条件</h2>
<pre class="mono">${this.esc(JSON.stringify(report.filters ?? {}, null, 2))}</pre>
<h2>审计条目(${entries.length} / 共 ${this.esc(report.total ?? 0)} 条)</h2>
<table><thead><tr><th>时间</th><th>动作</th><th>资源</th><th>用户</th><th>entryHash</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>存证指针(${attestations.length} 条)</h2>
<table><thead><tr><th>时间</th><th>类型</th><th>交易哈希</th><th>区块</th></tr></thead>
<tbody>${attestations
      .map(
        (a) =>
          `<tr><td>${this.esc(a.at)}</td><td>${this.esc(a.kind)}</td><td class="mono">${this.esc(a.txHash)}</td><td>${this.esc(a.block)}</td></tr>`,
      )
      .join("")}</tbody></table>
<h2>数字合约快照(${contracts.length} 条)</h2>
<table><thead><tr><th>合约ID</th><th>提供方</th><th>使用方</th><th>状态</th><th>哈希</th></tr></thead>
<tbody>${contracts
      .map(
        (c) =>
          `<tr><td>${this.esc(c.id)}</td><td>${this.esc(c.providerId)}</td><td>${this.esc(c.consumerId)}</td><td>${this.esc(c.status)}</td><td class="mono">${this.esc(c.hash ?? "-")}</td></tr>`,
      )
      .join("")}</tbody></table>
<p style="margin-top:32px;color:#64748b;font-size:12px">本报告由 MedTrust 自动生成;可在浏览器中打印为 PDF 归档。</p>
</body></html>`;
  }

  private esc(v: unknown): string {
    return String(v ?? "-")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
