// sm-crypto 无自带类型声明;connector 以 strict 模式编译,补最小环境声明。
declare module 'sm-crypto' {
  export function sm3(input: string | Uint8Array, options?: unknown): string;
  export const sm2: {
    generateKeyPairHex(): { publicKey: string; privateKey: string };
    doEncrypt(msg: string, publicKey: string, cipherMode?: number): string;
    doDecrypt(encryptData: string, privateKey: string, cipherMode?: number): string;
    doSignature(msg: string, privateKey: string, options?: unknown): string;
    doVerifySignature(
      msg: string,
      signature: string,
      publicKey: string,
      options?: unknown,
    ): boolean;
  };
  export const sm4: {
    encrypt(msg: string, key: string, options?: unknown): string;
    decrypt(encryptData: string, key: string, options?: unknown): string;
  };
}
