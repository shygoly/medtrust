/**
 * omop-data-source-access —— 数据产品的数据源声明（task 4.1 / 4.4，D-CN-6）。
 *
 * 控制面发布校验与连接器派发共用这一个解析器，两端对「这个产品的数据从哪来」
 * 不可能有两种理解：
 *
 *   { dataSource: { type: 'omop-cdm', label: 'main-cdm' } }   —— 院内 CDM 库
 *   { dataSource: { type: 'file', path: 'data/…' } }           —— 本地文件
 *   { localDataPath: 'data/…' }                                 —— 旧写法，等同 file
 *
 * 类型必须唯一：声明为 CDM 就不得再带文件路径——否则看上去像存在「库不可用时改读文件」
 * 的回退，而规格恰恰禁止静默切换。CDM 声明只允许 type 与 label：连接信息与凭据只存在于
 * 连接器侧配置，控制面只知道一个 label（D-CN-6）。
 */

export type DataSourceType = 'file' | 'omop-cdm';

export type DataSourceDeclaration =
  | { type: 'file'; path: string }
  | { type: 'omop-cdm'; label: string };

/** 数据源 label：连接器侧配置与控制面声明的唯一关联键。 */
export const DATA_SOURCE_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class DataSourceDeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceDeclarationError';
  }
}

const LEGACY_PATH_KEYS = ['localDataPath', 'dataPath'] as const;

function legacyPath(schema: Record<string, unknown>): string | null {
  for (const key of LEGACY_PATH_KEYS) {
    const raw = schema[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

/**
 * 解析数据产品的数据源声明。没有任何数据源声明返回 null（如纯服务类产品）；
 * 声明不合法一律抛——调用方不得猜测、不得回退。
 */
export function parseDataSourceDeclaration(
  fhirSchema?: Record<string, unknown> | null,
): DataSourceDeclaration | null {
  if (!fhirSchema) return null;
  const declared = fhirSchema.dataSource;
  const path = legacyPath(fhirSchema);

  if (declared === undefined || declared === null) {
    return path ? { type: 'file', path } : null;
  }
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    throw new DataSourceDeclarationError('dataSource 须为对象：{ type, label } 或 { type, path }');
  }
  const d = declared as Record<string, unknown>;

  if (d.type === 'omop-cdm') {
    const extra = Object.keys(d).filter((k) => k !== 'type' && k !== 'label');
    if (extra.length > 0) {
      throw new DataSourceDeclarationError(
        `CDM 数据源声明只允许 type 与 label，发现 ${extra.join(', ')}——` +
          '连接信息与凭据只存在于连接器侧配置，控制面不持有（D-CN-6）',
      );
    }
    if (typeof d.label !== 'string' || !DATA_SOURCE_LABEL_PATTERN.test(d.label)) {
      throw new DataSourceDeclarationError(
        `CDM 数据源声明缺少合法 label（小写字母数字与连字符，≤63）：${String(d.label)}`,
      );
    }
    if (path) {
      throw new DataSourceDeclarationError(
        `数据产品声明为 CDM 数据源（${d.label}），却同时带有本地文件路径——` +
          '数据源类型必须唯一，CDM 不可用时不存在改读文件的回退',
      );
    }
    return { type: 'omop-cdm', label: d.label };
  }

  if (d.type === 'file') {
    const extra = Object.keys(d).filter((k) => k !== 'type' && k !== 'path');
    if (extra.length > 0) {
      throw new DataSourceDeclarationError(`文件数据源声明只允许 type 与 path，发现 ${extra.join(', ')}`);
    }
    const own = typeof d.path === 'string' && d.path.trim() ? d.path.trim() : null;
    if (own && path && own !== path) {
      throw new DataSourceDeclarationError(`文件数据源声明了两个不同的路径：${own} / ${path}`);
    }
    const resolved = own ?? path;
    if (!resolved) throw new DataSourceDeclarationError('文件数据源声明缺少 path');
    return { type: 'file', path: resolved };
  }

  throw new DataSourceDeclarationError(
    `未知的数据源类型「${String(d.type)}」（只支持 file / omop-cdm）`,
  );
}
