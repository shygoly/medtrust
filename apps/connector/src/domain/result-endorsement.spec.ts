// on-chain-provider-endorsement task 1.2 —— 连接器结果级背书可被平台侧验过。
//
// 平台验签走 ConnectorAuthService.verifyPayloadSignature → GMCryptoService.sm2Verify
// → 国标 SM2 验签 verifySm2(message, sig, pub)（@medtrust/mdop）。这里直接复刻那条验证路径,
// 保证两端对「被签消息」的口径一致(口径漂移 = 全部背书验不过)。
import { sm2 } from 'sm-crypto';
import { verifySm2 } from './sm2-sign';
import {
  RESULT_ENDORSEMENT_PAYLOAD_PREFIX,
  resultEndorsementPayload,
  signResultEndorsement,
} from './result-endorsement';

const SM3 = 'a'.repeat(64);

describe('连接器结果级背书签名(on-chain-provider-endorsement)', () => {
  const keypair = sm2.generateKeyPairHex();

  it('签出的背书可用连接器证书公钥验过(= 平台侧验签路径)', () => {
    const e = signResultEndorsement(SM3, keypair.privateKey, 'SM2:ABCDEF');
    expect(e).toBeDefined();
    expect(e!.resultSm3).toBe(SM3);
    expect(e!.connectorCertFingerprint).toBe('SM2:ABCDEF');
    // 平台侧 verifyPayloadSignature 用的正是这条消息。
    const ok = verifySm2(
      resultEndorsementPayload(SM3),
      e!.connectorResultSig,
      keypair.publicKey,
    );
    expect(ok).toBe(true);
  });

  it('被签消息带域分离前缀 —— 不能与裸 sm3/任务签名互换', () => {
    expect(resultEndorsementPayload(SM3)).toBe(
      `${RESULT_ENDORSEMENT_PAYLOAD_PREFIX}${SM3}`,
    );
    const e = signResultEndorsement(SM3, keypair.privateKey, 'SM2:ABCDEF')!;
    // 同一签名拿去验「裸 sm3」必须失败(否则可被跨协议重放)。
    expect(verifySm2(SM3, e.connectorResultSig, keypair.publicKey)).toBe(
      false,
    );
  });

  it('换一个 resultSm3 即验不过(签的是结果,不是别的)', () => {
    const e = signResultEndorsement(SM3, keypair.privateKey, 'SM2:ABCDEF')!;
    const tampered = 'b'.repeat(64);
    expect(
      verifySm2(
        resultEndorsementPayload(tampered),
        e.connectorResultSig,
        keypair.publicKey,
      ),
    ).toBe(false);
  });

  it('缺私钥/指纹/非法 sm3 一律不出背书(不伪造)', () => {
    expect(signResultEndorsement(SM3, '', 'SM2:X')).toBeUndefined();
    expect(signResultEndorsement(SM3, keypair.privateKey, '')).toBeUndefined();
    expect(
      signResultEndorsement('not-a-hash', keypair.privateKey, 'SM2:X'),
    ).toBeUndefined();
  });

  it('大小写归一:传入大写 SM3 也按小写签(两端口径一致)', () => {
    const e = signResultEndorsement(SM3.toUpperCase(), keypair.privateKey, 'SM2:X')!;
    expect(e.resultSm3).toBe(SM3);
    expect(
      verifySm2(
        resultEndorsementPayload(SM3),
        e.connectorResultSig,
        keypair.publicKey,
      ),
    ).toBe(true);
  });
});
