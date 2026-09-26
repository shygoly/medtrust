# @medtrust/mdop — MDOP 协议核心（领域中立）

`docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md` 的可执行内核。平台编译器与连接器
复核**共用同一份实现**（D-MDOP-1）；连接器的独立性体现在**输入**上——它用自己的本地合约库、
本地白名单和本地算子清单重算，不采信平台的编译结果。

## 包内不放什么

本包 MUST NOT 出现患者、诊断、用药等医疗领域词（回归测试 `scripts/check-domain-neutral.mjs`
加 `src/domain-neutral.spec.ts`）。医疗 schema 放在调用方。

## 模块

| 模块 | 内容 |
| --- | --- |
| `canonical/jcs` | RFC 8785（JCS）规范化 |
| `crypto/sm3` | SM3 摘要与「JCS → SM3」口径 |
| `crypto/sm2` | 国标 SM2 签名/验签（GM/T 0003：Z_A + DER），旧格式 `verifyLegacy` |
| `envelope` | 信封构造、签名、四步接收方校验（签名/收件人/时间窗/nonce） |
| `label` | C0–C3 标签格、传播规则、跨节点边与能力匹配 |
| `schema` | 计划/片段/凭证/句柄/回执/算子清单的结构定义（拒未定义字段） |
| `plan` | 片段哈希与 `plan_hash` |
| `ticket` | 凭证构造与执行前校验 |
| `errors` | 错误码集合与可重试标记 |

## 脚本

```bash
pnpm --filter @medtrust/mdop test          # tsc + jest
pnpm --filter @medtrust/mdop test:interop  # 与 gmssl/Tongsuo 双向互验（装了才跑，否则如实跳过）
```
