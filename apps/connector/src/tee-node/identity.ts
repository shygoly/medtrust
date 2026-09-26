import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  generateSm2KeyPair,
  participantUrn,
  publicKeyFromPrivateKey,
  publicKeyKid,
} from '@medtrust/mdop';

/**
 * 可信空间节点的**自持身份**（任务 3.1、D-MDOP-3）。
 *
 * 三条硬要求，与数据持有方连接器同一套口径：
 *  ① 私钥**本地生成、本地保存**：平台 MUST NOT 生成或接触它，注册只提交公钥；
 *  ② 文件权限 MUST 是 **0600**：组/其他可读即拒绝加载（fail-closed，不留「先跑起来再说」的余地）；
 *  ③ 身份是**参与方 URN**，与本院连接器**不是同一把密钥、不是同一个参与方**——
 *     节点是独立参与方，密钥文件也与连接器分开（默认 `data/tee-node-sm2.key`）。
 *
 * 这里只做身份本身；「证明报告里的一次性公钥」由证明提供者每次会话现生成，
 * 与长期身份密钥**分离**（§3.1 最后一条）——两者混用会让「一次证明一次使用」失去意义。
 */

export const DEFAULT_NODE_KEY_FILE = 'data/tee-node-sm2.key';

export class NodeIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeIdentityError';
  }
}

export interface TeeNodeIdentity {
  participantId: string;
  /** 参与方 URN（信封 sender/receiver 与回执 signer 都用它）。 */
  urn: string;
  publicKey: string;
  /** 公钥 SM3 全长（kid；与协议 §7.1 一致）。 */
  kid: string;
  privateKey: string;
  keyFile: string;
}

function assertPrivateKeyShape(privateKey: string): void {
  if (!/^[0-9a-f]{64}$/.test(privateKey))
    throw new NodeIdentityError('节点 SM2 私钥必须是 64 位十六进制标量');
}

/** 私钥文件权限必须是 0600（仅属主可读写）；组/其他可读即拒。 */
export function assertNodeKeyFileMode(path: string): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new NodeIdentityError(
      `节点私钥文件权限必须是 0600（当前 ${mode.toString(8)}）：` +
        `组/其他可读即拒绝加载（run: chmod 600 ${path}）`,
    );
  }
}

/**
 * 载入节点身份；`create` 为真且文件不存在时**本地生成**并落盘（0600）。
 *
 * 刻意不提供「内联私钥环境变量」这条路径：连接器为容器注入留了它，
 * 但节点是长期在线、独立部署的参与方，密钥只从**受权限保护的文件**读，少一条泄露面。
 */
export function loadNodeIdentity(input: {
  participantId: string;
  keyFile: string;
  spaceId?: string;
  create?: boolean;
}): TeeNodeIdentity {
  if (!input.participantId) throw new NodeIdentityError('未指定节点参与方 id（TEE_NODE_PARTICIPANT_ID）');
  const keyFile = input.keyFile;
  if (!keyFile) throw new NodeIdentityError('未指定节点私钥文件路径（TEE_NODE_KEY_FILE）');

  let privateKey: string;
  try {
    statSync(keyFile);
    assertNodeKeyFileMode(keyFile);
    privateKey = readFileSync(keyFile, 'utf8').trim().toLowerCase();
    if (!privateKey) throw new NodeIdentityError(`节点私钥文件为空：${keyFile}`);
    assertPrivateKeyShape(privateKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    if (!input.create)
      throw new NodeIdentityError(
        `节点私钥不存在：${keyFile}（先生成：pnpm --filter @medtrust/connector tee-node -- keygen）`,
      );
    const generated = generateSm2KeyPair();
    mkdirSync(dirname(keyFile), { recursive: true });
    // mode 0600 在创建时就给上（不要把「先建成 0644 再 chmod」当成实现）
    writeFileSync(keyFile, `${generated.privateKey}\n`, { mode: 0o600 });
    privateKey = generated.privateKey;
  }

  const publicKey = publicKeyFromPrivateKey(privateKey);
  return {
    participantId: input.participantId,
    urn: participantUrn(input.spaceId ?? 'sh-med', input.participantId),
    publicKey,
    kid: publicKeyKid(publicKey),
    privateKey,
    keyFile,
  };
}
