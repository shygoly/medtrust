import { MdopError, sm3LabelToBytes } from '@medtrust/mdop';

/**
 * TDX REPORTDATA 装填约定（**已定案，勿改**：tee-attestation-pilot design §P3 发现 8，
 * 2026-09-27；本变更 spec 同款）：
 *
 *   硬件 64 字节 = 前 32 字节放 `reportDataBinding(pub)` 摘要中的 SM3 字节，其余置零。
 *
 * 分工边界（本文件只做纯函数，别越界）：
 *  - 协议层只存 `sm3:<64hex>` 摘要（`VendorQuote.report_data` / `AttestationReport.report_data`）；
 *  - **装填**是本适配器的职责（`fillTdxReportData`）；
 *  - **还原与比对**是校验方（信任根，任务 3.1）的职责：从**原始 quote** 里定位 REPORTDATA
 *    字段后，用 `extractTdxReportData` 还原出协议形状，与协议字段比对——「硬件覆盖」核验
 *    由信任根实现承担，协议核不代替。定位字段偏移需要真实 quote 的二进制布局，属真机侧。
 */

export const TDX_REPORTDATA_BYTES = 64;
export const TDX_REPORTDATA_DIGEST_BYTES = 32;

/**
 * 装填：`sm3:<64hex>` 绑定值 → 64 字节 REPORTDATA（前 32 字节摘要、其余置零）。
 * 入参不是合法 SM3 摘要标签时抛 `E_AUTH_INVALID`（调用方传的永远是
 * `reportDataBinding(...)` 的产物，抛错即实现 bug，不是运行时常态）。
 */
export function fillTdxReportData(binding: string): Uint8Array {
  const digest = sm3LabelToBytes(binding); // 32 字节；形状不对即抛
  const out = new Uint8Array(TDX_REPORTDATA_BYTES); // 缺省全零 —— 「其余置零」由此保证
  out.set(digest, 0);
  return out;
}

/**
 * 还原：64 字节 REPORTDATA → `sm3:<64hex>` 协议形状。
 * 两条硬判据，违反即 `E_ATTESTATION_FAILED`（fail-closed）：
 *  ① 长度必须是 64 字节（TDX REPORTDATA 的定长）；
 *  ② 第 32–63 字节必须全零——装填约定要求其余置零，出现非零字节说明装填方不守约，
 *    校验侧不得「只看前 32 字节就当比对通过」。
 */
export function extractTdxReportData(bytes: Uint8Array): string {
  if (bytes.length !== TDX_REPORTDATA_BYTES)
    throw new MdopError(
      'E_ATTESTATION_FAILED',
      {},
      `REPORTDATA 必须是 ${TDX_REPORTDATA_BYTES} 字节（TDX 装填约定），收到 ${bytes.length} 字节`,
    );
  for (let i = TDX_REPORTDATA_DIGEST_BYTES; i < TDX_REPORTDATA_BYTES; i += 1) {
    if (bytes[i] !== 0)
      throw new MdopError(
        'E_ATTESTATION_FAILED',
        {},
        'REPORTDATA 第 32–63 字节必须置零（装填约定），出现非零字节即拒',
      );
  }
  const hex = Array.from(bytes.slice(0, TDX_REPORTDATA_DIGEST_BYTES), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `sm3:${hex}`;
}
