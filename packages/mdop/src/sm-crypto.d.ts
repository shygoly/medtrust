// sm-crypto 无自带类型声明；本包以 strict 编译，补最小环境声明（与连接器同口径）。
declare module "sm-crypto" {
  export function sm3(input: string | Uint8Array | number[], options?: unknown): string;
  export const sm2: {
    generateKeyPairHex(): { publicKey: string; privateKey: string };
    getPublicKeyFromPrivateKey(privateKey: string): string;
    /** `msg` 为 string 时按 UTF-8 编码；传字节数组时原样使用（sm-crypto 两种都支持）。 */
    doEncrypt(msg: string | number[], publicKey: string, cipherMode?: number): string;
    doDecrypt(
      encryptData: string,
      privateKey: string,
      cipherMode?: number,
      options?: { output?: "string" | "array" },
    ): string | number[];
    doSignature(msg: string | number[], privateKey: string, options?: unknown): string;
    doVerifySignature(
      msg: string | number[],
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
