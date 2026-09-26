import { readFileSync } from 'node:fs';

/**
 * 节点侧的**参与方登记公钥表**（部署配置）。
 *
 * 为什么必须是部署侧给的、而不是从消息里取：
 * 节点要验**合约副本的持有方签名**与**C2 信封的持有方签名**。如果公钥随消息一起下来，
 * 平台就能「换一把公钥 + 换一份 canonical + 补一个签名」，让节点接受一份持有方从未签过的合约
 * （签名是用平台给的公钥验的——循环论证）。因此持有方公钥与平台节点公钥、注册中心公钥一样，
 * 属于**部署锚**：写成文件放进来，消息说了不算。
 *
 * 文件形状（JSON）：`{ "<参与方 URN>": "<SM2 公钥 hex>" }`；
 * 公钥接受 128 位十六进制（无前缀）或 130 位（`04` 前缀，未压缩点）。
 * 任何一条不合法 → 整份拒（fail-closed，不留半份登记表）。
 */

export class ParticipantKeysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParticipantKeysError';
  }
}

const HEX_KEY = /^(04)?[0-9a-fA-F]{128}$/;

export function loadParticipantKeys(file: string): Map<string, string> {
  if (!file) throw new ParticipantKeysError('未配置参与方登记公钥文件');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ParticipantKeysError(`参与方登记公钥文件读取失败：${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new ParticipantKeysError('参与方登记公钥文件必须是 { "<URN>": "<公钥hex>" } 形状');
  const out = new Map<string, string>();
  for (const [urn, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (!urn.startsWith('urn:'))
      throw new ParticipantKeysError(`登记表里的键必须是参与方 URN：${urn}`);
    if (typeof key !== 'string' || !HEX_KEY.test(key))
      throw new ParticipantKeysError(`参与方 ${urn} 的公钥不是合法的 SM2 公钥 hex`);
    out.set(urn, key);
  }
  return out;
}

/** 节点参与方登记表的配置（逐键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。 */
export function nodeParticipantKeysEnv(): { keysFile: string } {
  return { keysFile: (process.env.TEE_NODE_PARTICIPANT_KEYS_FILE ?? '').trim() };
}
