import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import { ParticipantKeysError, loadParticipantKeys, nodeParticipantKeysEnv } from './participant-keys';

/**
 * 参与方登记公钥表（部署锚）。
 *
 * 为什么它必须是部署侧文件：节点用这些公钥验**合约副本的持有方签名**与**C2 信封签名**。
 * 若公钥随消息下来，平台就能「换公钥 + 换 canonical + 补签名」让节点接受一份持有方从未签过的合约
 * （用平台给的公钥验平台给的签名——循环论证）。
 */

const KEYS = generateSm2KeyPair();
const HOSP = 'urn:tds:sh-med:participant:p-huashan';

function write(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tee-keys-'));
  const file = join(dir, 'participants.json');
  writeFileSync(file, contents);
  return file;
}

describe('参与方登记公钥表（部署锚）', () => {
  it('合法文件：URN → 公钥（支持带/不带 04 前缀的未压缩点）', () => {
    const withPrefix = loadParticipantKeys(
      write(JSON.stringify({ [HOSP]: publicKeyFromPrivateKey(KEYS.privateKey) })),
    );
    expect(withPrefix.get(HOSP)).toBe(publicKeyFromPrivateKey(KEYS.privateKey));
    const bare = loadParticipantKeys(
      write(JSON.stringify({ [HOSP]: publicKeyFromPrivateKey(KEYS.privateKey).replace(/^04/, '') })),
    );
    expect(bare.size).toBe(1);
  });

  it('任何一条不合法 → 整份拒（不留半份登记表）', () => {
    expect(() => loadParticipantKeys(write('[]'))).toThrow(ParticipantKeysError);
    expect(() => loadParticipantKeys(write('"x"'))).toThrow(ParticipantKeysError);
    expect(() => loadParticipantKeys(write(JSON.stringify({ 'p-huashan': KEYS.publicKey })))).toThrow(
      /URN/,
    );
    expect(() => loadParticipantKeys(write(JSON.stringify({ [HOSP]: 'not-a-key' })))).toThrow(
      /公钥/,
    );
    expect(() => loadParticipantKeys(write(JSON.stringify({ [HOSP]: KEYS.publicKey, 'urn:b': 1 })))).toThrow(
      /公钥/,
    );
    expect(() => loadParticipantKeys(join(tmpdir(), 'does-not-exist.json'))).toThrow(/读取失败/);
    expect(() => loadParticipantKeys('')).toThrow(/未配置/);
  });

  it('配置逐键直读（未配置即空，不取默认值）', () => {
    const before = process.env.TEE_NODE_PARTICIPANT_KEYS_FILE;
    try {
      process.env.TEE_NODE_PARTICIPANT_KEYS_FILE = ' /etc/tee-node/participants.json ';
      expect(nodeParticipantKeysEnv().keysFile).toBe('/etc/tee-node/participants.json');
      delete process.env.TEE_NODE_PARTICIPANT_KEYS_FILE;
      expect(nodeParticipantKeysEnv().keysFile).toBe('');
    } finally {
      if (before === undefined) delete process.env.TEE_NODE_PARTICIPANT_KEYS_FILE;
      else process.env.TEE_NODE_PARTICIPANT_KEYS_FILE = before;
    }
  });
});
