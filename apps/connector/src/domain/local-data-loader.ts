import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { Deidentifier } from './deidentifier';
import { FhirGateway } from './fhir-gateway';
import { InternalRecord } from './types';
import { assertReadablePath, resolveLocalDataPath } from './local-data-path';
import { loadFhirBundleFile } from './fhir-bundle-loader';
import { detectClinicalTextPayload, loadClinicalTextFile } from './clinical-text-loader';

export type LocalDataFormat = 'clinical_text' | 'fhir_bundle' | 'fhir_bundle_synthea' | 'unknown';

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
  ) {}

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

    const format = this.detectFileFormat(jsonFiles[0]);
    const records: InternalRecord[] = [];
    for (const file of jsonFiles) {
      records.push(...this.loadFile(file, format));
    }

    return {
      records,
      resolvedPath: absolutePath,
      format,
      fileCount: jsonFiles.length,
    };
  }

  private detectFileFormat(filePath: string): LocalDataFormat {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (detectClinicalTextPayload(obj)) return 'clinical_text';
    if (obj && typeof obj === 'object' && (obj as { resourceType?: string }).resourceType === 'Bundle') {
      const entries = ((obj as { entry?: { resource?: { resourceType?: string } }[] }).entry) ?? [];
      const hasSyntheaNarrative = entries.some((e) => e.resource?.resourceType === 'DiagnosticReport');
      return hasSyntheaNarrative ? 'fhir_bundle_synthea' : 'fhir_bundle';
    }
    return 'unknown';
  }

  private loadFile(filePath: string, format: LocalDataFormat): InternalRecord[] {
    if (format === 'clinical_text') {
      return loadClinicalTextFile(filePath);
    }

    if (format === 'fhir_bundle_synthea') {
      const raw = loadFhirBundleFile(filePath);
      return raw.map((r) => this.deid.deidentify(r));
    }

    if (format === 'fhir_bundle') {
      const bundle = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return this.fhirGateway.fromBundle(bundle).map((r) => this.deid.deidentify(r));
    }

    throw new Error(`无法识别的本地数据格式: ${filePath}`);
  }
}
