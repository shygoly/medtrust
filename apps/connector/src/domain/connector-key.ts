// 连接器自持的 SM2 私钥：本地生成、本地保存（0600），注册只交公钥（D-MDOP-3）。
//
// 解析顺序：`CONNECTOR_SM2_PRIVATE_KEY`（内联，测试/容器注入）→
// `CONNECTOR_SM2_PRIVATE_KEY_FILE`（默认 `data/connector-sm2.key`）。
// 私钥文件权限 MUST 是 0600：组/其他可读即拒绝启动（fail-closed）。
import { readFileSync, statSync } from 'node:fs';
import { publicKeyFromPrivateKey } from '@medtrust/mdop';

export const DEFAULT_CONNECTOR_KEY_FILE = 'data/connector-sm2.key';

/**
 * 私钥文件路径。走 `process.env` 直接读取，使部署登记表（DEPLOY.md §2）与代码读取点
 * 能被同一套双向对拍机检到。
 */
export function connectorKeyFilePath(): string {
  return (process.env.CONNECTOR_SM2_PRIVATE_KEY_FILE ?? DEFAULT_CONNECTOR_KEY_FILE).trim();
}

export class ConnectorKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorKeyError';
  }
}

function assertPrivateKeyShape(privateKey: string): void {
  if (!/^[0-9a-f]{64}$/.test(privateKey))
    throw new ConnectorKeyError('连接器 SM2 私钥必须是 64 位十六进制标量');
}

/** 私钥文件权限必须是 0600（仅属主可读写）。 */
export function assertKeyFileMode(path: string): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new ConnectorKeyError(
      `连接器私钥文件权限必须是 0600（当前 ${mode.toString(8)}）：` +
        `组/其他可读即拒绝加载（run: chmod 600 ${path}）`,
    );
  }
}

/**
 * 读连接器自己的私钥。返回空串表示「未配置」——调用方据此走无签名路径
 * （只有显式开启的令牌降级才允许，缺省 fail-closed）。
 */
export function loadConnectorPrivateKey(env: NodeJS.ProcessEnv = process.env): string {
  const inline = (env.CONNECTOR_SM2_PRIVATE_KEY ?? '').trim();
  if (inline) {
    assertPrivateKeyShape(inline.toLowerCase());
    return inline.toLowerCase();
  }
  const file =
    env === process.env
      ? connectorKeyFilePath()
      : (env.CONNECTOR_SM2_PRIVATE_KEY_FILE ?? DEFAULT_CONNECTOR_KEY_FILE).trim();
  if (!file) return '';
  try {
    statSync(file);
  } catch {
    return '';
  }
  assertKeyFileMode(file);
  const value = readFileSync(file, 'utf8').trim().toLowerCase();
  if (!value) throw new ConnectorKeyError(`连接器私钥文件为空：${file}`);
  assertPrivateKeyShape(value);
  return value;
}

/** 由私钥推出公钥（注册时提交的就是它）。 */
export function connectorPublicKey(privateKey: string): string {
  assertPrivateKeyShape(privateKey);
  return publicKeyFromPrivateKey(privateKey);
}
