import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Optional } from '@nestjs/common';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { InternalRecord, RawPatientRecord } from './types';
import { assertNoBuiltinBypass, resolveDeidMode } from './deid/deid-mode';
import { AlignmentLinker } from './alignment/alignment-linker';
import { assertReadablePath, resolveLocalDataPath } from './local-data-path';
import { loadFhirBundleFile } from './fhir-bundle-loader';
import { detectClinicalTextPayload, loadClinicalTextFile } from './clinical-text-loader';
import { detectSyntheaPatientPayload, loadSyntheaPatientFile } from './synthea-patient-loader';
import {
  detectInternalRecordsPayload,
  loadInternalRecordsFile,
} from './internal-record-loader';

export type LocalDataFormat =
  | 'clinical_text'
  | 'fhir_bundle'
  | 'fhir_bundle_synthea'
  | 'synthea_patient'
  | 'internal_records'
  | 'unknown';

export interface LocalDataLoadResult {
  records: InternalRecord[];
  resolvedPath: string;
  format: LocalDataFormat;
  fileCount: number;
}

@Injectable()
export class LocalDataLoader {
  constructor(
    private readonly deid: Deidentifier,
    private readonly fhirGateway: FhirGateway = new FhirGateway(),
    /**
     * 跨院对齐键派生（Phase 3 / D-CN-10）。**这是唯一写 `linkKey` 的地方**：
     * 派生需要真实标识，而去标识后标识就没了，所以必须在这一步做。
     * 未配置对齐密钥时它是 null（或 disabled），记录就不带 `linkKey` → 跨院投影自动跳过。
     */
    @Optional() private readonly alignment?: AlignmentLinker,
  ) {}

  /** 去标识 + （若启用）对齐键；`subjectKey` 与 `linkKey` 各自独立口径，互不替代。 */
  private identify(raw: RawPatientRecord): InternalRecord {
    const record = this.deid.deidentify(raw);
    if (!this.alignment?.enabled) return record;
    return this.alignment.attach(record, raw.patientId);
  }

  /** Load connector-local records from a catalog-declared path (file or directory). */
  loadFromDeclaredPath(
    declaredPath: string,
    dataRoot?: string,
  ): LocalDataLoadResult {
    const resolvedPath = resolveLocalDataPath(declaredPath, dataRoot);
    assertReadablePath(resolvedPath);
    return this.loadFromAbsolutePath(resolvedPath);
  }

  loadFromAbsolutePath(absolutePath: string): LocalDataLoadResult {
    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) {
      const format = this.detectFileFormat(absolutePath);
      const records = this.loadFile(absolutePath, format);
      return { records, resolvedPath: absolutePath, format, fileCount: 1 };
    }

    const jsonFiles = fs
      .readdirSync(absolutePath)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(absolutePath, f))
      .sort();

    if (!jsonFiles.length) {
      throw new Error(`目录内无 JSON 数据文件: ${absolutePath}`);
    }

    // Injected RWS datasets ship records.json + truth/answer-key sidecars —
    // prefer the clinical payload file so sidecar JSON is not mis-detected.
    const recordsJson = path.join(absolutePath, 'records.json');
    const preferred = fs.existsSync(recordsJson) ? [recordsJson] : jsonFiles;

    const format = this.detectFileFormat(preferred[0]);
    const records: InternalRecord[] = [];
    for (const file of preferred) {
      records.push(...this.loadFile(file, format));
    }

    return {
      records,
      resolvedPath: absolutePath,
      format,
      fileCount: preferred.length,
    };
  }

  private detectFileFormat(filePath: string): LocalDataFormat {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (detectClinicalTextPayload(obj)) return 'clinical_text';
    if (detectSyntheaPatientPayload(obj)) return 'synthea_patient';
    if (detectInternalRecordsPayload(obj)) return 'internal_records';
    if (obj && typeof obj === 'object' && (obj as { resourceType?: string }).resourceType === 'Bundle') {
      const entries = ((obj as { entry?: { resource?: { resourceType?: string } }[] }).entry) ?? [];
      const hasSyntheaNarrative = entries.some((e) => e.resource?.resourceType === 'DiagnosticReport');
      return hasSyntheaNarrative ? 'fhir_bundle_synthea' : 'fhir_bundle';
    }
    return 'unknown';
  }

  private loadFile(filePath: string, format: LocalDataFormat): InternalRecord[] {
    // connector-agent-deidentification（D-CN-9）：需要脱敏的摄入分支在 `agent` 模式下
    // **禁止**走本地逐行脱敏 —— 口径必须来自平台签发的规格，由院内 agent 执行。
    // 这里是最早能拦住"绕过"的位置：越晚拦，越可能已经把弱脱敏结果写进本地库。
    if (format !== 'clinical_text' && format !== 'internal_records') {
      assertNoBuiltinBypass(resolveDeidMode(), `LocalDataLoader(${format})`);
    }

    if (format === 'clinical_text') {
      return loadClinicalTextFile(filePath);
    }

    if (format === 'fhir_bundle_synthea') {
      const raw = loadFhirBundleFile(filePath);
      return raw.map((r) => this.identify(r));
    }

    if (format === 'synthea_patient') {
      return loadSyntheaPatientFile(filePath).map((r) => this.identify(r));
    }

    if (format === 'internal_records') {
      // Already de-identified InternalRecord[] from the injection layer.
      return loadInternalRecordsFile(filePath);
    }

    if (format === 'fhir_bundle') {
      const bundle = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return this.fhirGateway.fromBundle(bundle).map((r) => this.identify(r));
    }

    throw new Error(`无法识别的本地数据格式: ${filePath}`);
  }
}
