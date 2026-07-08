/**
 * @deprecated Import from `../domain/fhir-bundle-loader` instead.
 * Kept for existing demo scripts.
 */
export {
  loadFhirBundleDirectory as loadSyntheaHospitalDir,
  loadFhirBundleFile,
} from '../domain/fhir-bundle-loader';

import * as path from 'path';

/** Resolve default hospital FHIR path relative to monorepo root. */
export function defaultHospitalFhirPath(hospitalKey: 'huashan' | 'ruijin'): string {
  const repo = path.resolve(__dirname, '../../../..');
  return path.join(repo, 'data/synthea/hospitals', hospitalKey, 'fhir');
}
