import { MdopError, type AttestationCollateral } from '@medtrust/mdop';

/**
 * TDX quote source 端口：真实 TDX 工具链（tdx_att / 云厂商 SDK / sidecar）的可注入抽象。
 *
 * 为什么是端口而不是直接调用：Node.js 没有原生 TDX 工具链（本变更 design 风险表），
 * 真机侧预期以子进程 / sidecar / 云 SDK 实现并**在部署时注入**（任务 1.1 / 2.4 接线）。
 * 工具链差异（quote 版本 v2/v3、TDX 1.0/1.5、云厂商 CLI 形状）收在这个端口之后，
 * 接缝外（`TdxAttestationProvider` 及其调用点）不感知。
 *
 * collateral（crl + qvl，任务 2.2 的 PCCS / Intel PCS 取回）也走同一端口随 quote 一起给出：
 * 真实工具链在出 quote 时本来就伴随取料，拆两个端口只会让「quote 与材料不配套」成为可能。
 */

export interface TdxQuoteRequest {
  /** 已按装填约定填好的 64 字节 REPORTDATA（前 32 字节 = 一次性公钥绑定的 SM3，其余置零）。 */
  reportData: Uint8Array;
}

export interface TdxQuoteResult {
  /** 原生 quote 的 base64（`VendorQuote.quote` 的来源；摘要与锚定只用这个）。 */
  quoteBase64: string;
  /** quote 覆盖的 MRTD 整机镜像度量，`sm3:<64hex>`。 */
  mrtd: string;
  /** TCB 点分数字（如 `8.1.0`）——MUST 由真实 quote 解析得出，**不得手填**（design P1/P2）。 */
  tcb: string;
  /** 校验 quote 所需的信任材料：至少 `crl` + `qvl`，带 `fetched_at` / `next_update`（任务 2.2）。 */
  collateral: AttestationCollateral[];
}

export interface TdxQuoteSource {
  requestQuote(request: TdxQuoteRequest): Promise<TdxQuoteResult>;
}

/**
 * 缺省实现：**未接线即抛错**（fail-closed）。
 * 与 `tee-node/providers.ts` 的两处接缝同一口径——宁可起不来，也不给「默默降级成软件证明」
 * 的机会。真机接线（任务 1.1 / 2.4）后由部署方注入真实实现替换本类。
 */
export class UnwiredTdxQuoteSource implements TdxQuoteSource {
  async requestQuote(_request: TdxQuoteRequest): Promise<TdxQuoteResult> {
    throw new MdopError(
      'E_ATTESTATION_FAILED',
      {},
      'TDX quote 工具链未接线：真实实现（tdx_att / 云 SDK / sidecar）在真机侧注入'
        + '（tdx-attestation-pilot 任务 1.1 / 2.4）；未接线即 fail-closed，不得以软件替身顶替',
    );
  }
}
