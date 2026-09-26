import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import {
  ConnectorKeyError,
  assertKeyFileMode,
  connectorPublicKey,
  loadConnectorPrivateKey,
} from './connector-key';

describe('连接器密钥自持（D-MDOP-3 / 任务 4.4）', () => {
  const pair = generateSm2KeyPair();
  const dir = mkdtempSync(join(tmpdir(), 'connector-key-'));

  it('内联私钥优先，且形态非法即拒', () => {
    expect(
      loadConnectorPrivateKey({ CONNECTOR_SM2_PRIVATE_KEY: pair.privateKey } as NodeJS.ProcessEnv),
    ).toBe(pair.privateKey);
    expect(() =>
      loadConnectorPrivateKey({ CONNECTOR_SM2_PRIVATE_KEY: 'nope' } as NodeJS.ProcessEnv),
    ).toThrow(ConnectorKeyError);
  });

  it('未配置文件 → 返回空串（调用方据此 fail-closed）', () => {
    expect(
      loadConnectorPrivateKey({
        CONNECTOR_SM2_PRIVATE_KEY_FILE: join(dir, 'missing.key'),
      } as NodeJS.ProcessEnv),
    ).toBe('');
  });

  it('0600 的私钥文件可加载；组/其他可读即拒', () => {
    const okFile = join(dir, 'ok.key');
    writeFileSync(okFile, `${pair.privateKey}\n`, { mode: 0o600 });
    chmodSync(okFile, 0o600);
    expect(
      loadConnectorPrivateKey({ CONNECTOR_SM2_PRIVATE_KEY_FILE: okFile } as NodeJS.ProcessEnv),
    ).toBe(pair.privateKey);

    const looseFile = join(dir, 'loose.key');
    writeFileSync(looseFile, `${pair.privateKey}\n`, { mode: 0o644 });
    chmodSync(looseFile, 0o644);
    expect(() => assertKeyFileMode(looseFile)).toThrow(/0600/);
    expect(() =>
      loadConnectorPrivateKey({
        CONNECTOR_SM2_PRIVATE_KEY_FILE: looseFile,
      } as NodeJS.ProcessEnv),
    ).toThrow(ConnectorKeyError);
  });

  it('由私钥推出注册用的公钥', () => {
    expect(connectorPublicKey(pair.privateKey)).toBe(pair.publicKey);
    expect(connectorPublicKey(pair.privateKey)).toBe(publicKeyFromPrivateKey(pair.privateKey));
  });
});
