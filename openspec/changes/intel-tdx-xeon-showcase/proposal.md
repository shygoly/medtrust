## Why

与 Intel 谈生态/联合方案背书，需要一套**真跑**的演示：同一平台上既用到 Intel TDX（可信计算），又用到至强 AMX 推理（LLM），且落在医疗业务价值上。现状是证明链只在命令行工具层打通（`tdx-attestation-pilot` RECORD §2/§3.5），未接进平台；LLM 只接外部 DeepSeek，没有任何 Intel 推理栈；三台机器（teeA / teeB / LLMA）已就位但 LLMA 是空机。

## What Changes

- **场景 1 · 跨机构联合统计（TDX 主线）**：两院合成数据封存 → teeA 出真实 TDX quote → teeB 验签到 Intel 证明根并释放密钥 → 节点内计算 → 只出 C3 聚合 → 回执上链。实现工作**全部归 `tdx-attestation-pilot` tasks 2.4 / 3.x / 4.x**，本变更只依赖其完成并取证，不重复立项。
- **两域网络真实分离作为演示事实**：teeA 与 teeB 已分属两个 VPC（域 A `172.16.0.0/12` / 域 B `10.10.0.0/16`，对等连接互通，RECORD §3.6），场景 1 的证明与密钥释放跨的是真实网络边界。本变更把跨域放行从当前的「全通」收紧到演示所需的最小端口集。
- **场景 2 · 至强推理服务（LLM 主线）**：LLMA（Xeon 6 6982P-C，AMX，2 vCPU / 8G）部署 OpenVINO Model Server + 最小量化模型，提供 OpenAI 兼容接口；新增「C3 聚合结果 → 研究解读草稿」能力，推理走 LLMA。LLMA 非 TEE，**只接触 C3 聚合结果与研究问题文本**。任务设计助手不改（实测该机型跑不动它的长提示词，见 design S3）。
- **演示取证与视频**：关键步骤真实截图清单（来源均为真实运行）+ 宣传视频（沿用 `video/scripts/render-scenes.mjs` 按页渲染）。
- **治理同步**：AGENT.md 新登记解读 agent（AGT-04）；FLOWS.md 新增 FLOW-AI-04（推理步不跨域）；DECISIONS 新增 D-AI-2（自托管端点算控制面内部的成立条件）；`external-claims.md` 推理栈表述由「vLLM + IPEX-LLM」改为 OpenVINO，并如实写机型。
- **部署收口**：LLMA 位于域 A，当前绑公网 IP 且域 B 经对等连接可直达（实测 teeB → LLMA 22 端口通）。收紧为：推理服务只监听本机回环，控制面（ali29）经 SSH 隧道访问；LLMA 入方向只留 22 且限 ali29 与运维来源。

不做：机密推理（TDX 内跑模型）、GPU、真实患者数据、生产 KMS。

## Capabilities

### New Capabilities
- `self-hosted-llm-inference`: 自托管推理端点上的 C3 结果解读——入参聚合字段白名单、数值服务端计算 + 输出数字回查、失败即显式不可用（不回落外部供应商）、端点仅控制面可达。
- `intel-showcase-evidence`: 演示取证与对外物料契约——截图/视频每一帧可追溯到真实运行证据，表述不越 `external-claims.md` 红线。

### Modified Capabilities
<!-- 无：场景 1 的需求变更在 tdx-attestation-pilot 的 attestation-provider delta 内，本变更不改其要求 -->

## Impact

- 代码：新模块 `apps/api/src/result-interpreter/`；web 作业详情页加解读面板（`components/console/result-interpretation-panel.tsx`）。
- 治理：`AGENT.md` §2、`FLOWS.md`（新增 flow）、`DECISIONS.md` D-AI-2、`TRUST.md` CTL-11 适用范围注记、`openspec/changes/tdx-attestation-pilot/external-claims.md`。
- 部署：LLMA 上的 OVMS 与模型；域 A / 域 B 安全组（`sg-domainb-tee` 现对 `172.16.0.0/12` 放行 ALL）；`DEPLOY.md` 增一节。
- 依赖：`tdx-attestation-pilot` 2.4 / 3.x / 4.x 先完成，场景 1 才能取证。
- 物料：`video/`（gitignored 本地产物）新增场景页；截图入 `openspec/changes/intel-tdx-xeon-showcase/evidence/`。
