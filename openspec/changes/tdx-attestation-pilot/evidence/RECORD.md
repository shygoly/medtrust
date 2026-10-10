# TDX 试点实测记录（tdx-attestation-pilot）

> 证据等级标注：**A = 机器可复核的二进制/日志证据**；**B = 控制台截图/单据类证据**；**C = 口径陈述**。
> 表述红线（design P6）：本记录支持的最高表述为「**已在云上 TDX 机型完成一次真实证明的端到端验证（合成数据）**」，
> 不得表述为「已具备硬件机密计算能力 / C2 生产可用 / 数据绝对安全」。
> 院内连接器 `attestationLevel` 恒 `software`（D9 / CTL-09），不因本记录改变。

## 1. 机型开通与部署事实（tasks 1.1）——四事实入账

| 部署事实 | 值 | 证据 |
|---|---|---|
| 机型 SKU | `ecs.g8i.xlarge`（4 vCPU / 16 GiB，Intel Sapphire Rapids） | B（购买单）/ A（下述 CPUID） |
| region | `cn-beijing`（华北2）可用区 **L**，默认 VPC `vpc-2zeolki31xtoffgegdm3d` / vSwitch `vsw-2zebtm46clqi6q80hhgse` | B |
| TDX module 版本 | quote **V5**（`att_key_type=2` ECDSA-P384，`tee_type=0x81` TDX；`PCE_SVN=13`；`TEE_TCB_SVN=05010300000000000000000000000000`） | A（evidence/quote-20261002.bin 头部 + run2 日志） |
| TCB 版本 | `TEE_TCB_SVN = 05 01 03 …`（点分 **5.1.3**，取自真实 quote，非手填）；FMSPC `90c06f000000`；Intel PCS 判定 TCB 状态 **OutOfDate**（阿里云文档预告的预期态，见 §4 注意） | A |

实例事实：`i-2ze8qci4r5ec6trmywi0`，按量付费（¥1.0885/时），创建于 2026-10-01 22:19 (UTC+8)。
镜像：Alibaba Cloud Linux 3.2104 LTS 64位 UEFI（机密虚拟机选项），内核 `5.10.134-19.8.al8.x86_64`（≥ 5.10.134-16 要求）。
开机自检：`dmesg` 含 `tdx: Guest detected`、`Memory Encryption Features active: Intel TDX`；`lscpu` flags 含 `tdx_guest`；`/dev/tdx_guest` 存在（A）。

## 2. 真机冒烟：真实 quote 产出与验签（tasks 2.4 前半，D-TEE-3 ② 解除条件前半句）

- 工具链：[anolis/go-tdx-guest](https://gitee.com/anolis/go-tdx-guest) `tools/tdx-lab`（go1.26.5，源码构建）。
- **quote 原文**：`evidence/quote-20261002.bin`，**5006 字节**，REPORTDATA 装填 = 前 32 字节固定演示摘要（`\x11\x22…` 重复）、其余置零（对齐 2026-09-27 定案约定的演示形态）。
- **quote 摘要**：sha384 `5dcfe2a21ab8dc549ce54969f7b1ed3b002d9d923b9efbce34e23e31d32cc8a6ee292188e2448fc6d9bc161cdc44c286`（A）。
- **度量**：`MR_TD = e0199499baacb2e4f4bc73046f25bedf674d42defbe4e854242bd6554a9d155edf7f3bff8e6202e63ed230e59ab2568a`；
  RTMR[0..3] 与 CCEL 事件日志回放全过（run2 日志，A）。
- **验签**（tdx-lab `--skip-early`，collateral 直取 Intel PCS）：
  - `Full verification with collateral` **PASS**（链验到 Intel 证明根，1718ms）
  - `Verification with CRL revocation check` **PASS**（1313ms）
  - `Relaxed TCB check` **PASS**；`Strict TCB check (UpToDate only)` FAIL——平台 TCB 为 OutOfDate，属阿里云文档明示的预期行为（"当前不承诺 tcb 状态为 UpToDate"），非验签失败。
- **耗时**：TD Report 生成 0ms 级；单次 quote 生成 **3–4ms**；全量验签（含 collateral 取回）**1718ms**。

## 3. 发现与回写（供实现阶段吸收）

1. **PCCS 时效风险实证**（对应 design 风险表「collateral 时效误配」）：北京 PCCS（`sgx-dcap-server-vpc.cn-beijing.aliyuncs.com`）返回的 `tcbInfo` **已过期**（run1 日志，5 项 collateral 校验全挂 `tcbInfo has expired`）；**绕行**：TDVM 直连 Intel PCS 取 collateral 后全链通过（run2）。
   → `TrustedRootWithCollateral` 的实现（tasks 3.1）应支持 collateral 源优先级/降级（Intel PCS 直取或本地缓存 + `max_staleness_minutes` 拒绝过期料），不得盲信单一 PCCS 源。
2. **TCB 状态策略**：平台 TCB = OutOfDate。控制面 `AttestationPolicy`（tasks 4.2）的 `min_tcb` 以实测 `TEE_TCB_SVN=5.1.3` 回填，且接受状态不得只含 UpToDate（负例用例 tasks 3.3 同步覆盖）。
3. **接口形态**：Alinux 3 走 `/dev/tdx_guest` ioctl（configfs TSM 不可用，`/sys/kernel/config/tsm/report` 不存在）→ `TdxAttestationProvider`（tasks 2.1）的 sidecar 形态按 ioctl 路径实现。

## 3.5 真实 TEE 跨域证明流（两台 TDVM，tasks 3.1/4.3 的最小实机预演）

2026-10-02，A 域（`i-2ze8qci4r5ec6trmywi0`，123.56.29.7，证明方）× B 域（`i-2zegnqenh9yx2e0g2c8o`，8.141.24.92，校验方/KMS 形状），工具 `xdattest`（go-tdx-guest + tjfoc/gmsm，源码在两机 `/root/go-tdx-guest/tools/xdattest/`）：

1. **A 域 prove**：一次性 SM2 密钥对 → 按定案约定装填 REPORTDATA（前 32B = `sm3(pub)`，其余置零）→ ioctl 取真实 quote（**5010B，4ms**）。quote sha384 `9440c8eb…1435`。
2. **B 域 verify**（quote 经第三方中转，跨域边界物理真实）：
   - **硬件覆盖核验**：从原始 quote 提取 REPORTDATA，与 `sm3(pub)` 比对 **PASS**（尾 32B 全零 ✓）——即 tasks 3.1 `verifyQuoteDigest` 的两件事（链验根 + REPORTDATA 比对）的实机版；
   - **验签链到 Intel 证明根 PASS**（collateral 直取 Intel PCS，**1728ms**）；
   - MRTD `e0199499…568a`、`TEE_TCB_SVN=5.1.3` 与 §2 单机实测一致（同一镜像）；
   - **密钥释放**：随机 32B 会话密钥以 SM2(C1C3C2) 封给 REPORTDATA 绑定的一次性公钥。
3. **A 域 open**：以一次性私钥解封成功（`7db12e7e…42ed8`）——密钥只落到证明绑定持有者，闭环完成。

证据：`evidence/cross-domain/{prove-nodeA.json, quote-nodeA.bin, verdict-nodeB.json, released.b64}`（等级 A）。
边界：会话密钥为演示形状（非生产 KMS，D-TEE-1 另行）；中转通道未认证（试点不设防）；此预演 ≠ tasks 4.3 端到端（后者须接 `TdxAttestationProvider`/`TEE_ATTESTATION_REGISTRY` 装配与 C3 出口闸，调用点零改动口径不变）。



## 3.6 两域（L1）网络分离与跨域连通实测（2026-10-02 晚，本轮）

**动机**：teeA/teeB 同 VPC 时，"跨域数据汇集"只是进程级模拟；两院形态要求**网络域真实分离**（D1 双平面与「连接器只出站」等不变量才有可验证前提）。故给 teeB 单独划一个 VPC。

拓扑与实测（等级 A，命令与结果可复跑）：

| 项 | 值 |
|---|---|
| 域 A | `vpc-2zeolki31xtoffgegdm3d`（`172.16.0.0/12`）：teeA `172.21.6.201`、LLMA `172.21.6.203` |
| 域 B | `vpc-2zevz3jdj63wvr4tz5yr2`（`10.10.0.0/16`，2026-10-02 新建）：teeB `10.10.0.10` |
| 域 B 交换机 | `vsw-2zelabsfpcezvvcqzh1ne`（cn-beijing-l，与 teeB 原交换机同可用区——换 VPC 的硬要求） |
| 域 B 安全组 | `sg-2zeemp3q00i5os13e2m8`（`sg-domainb-tee`；收紧后入方向仅 7 条：跨域 `172.16.0.0/12` ALL + 22 端口若干来源） |
| 对等连接 | `pcc-k4kg47h5r5d2gkp0c6`（`medtrust-domain-a-b`，**Activated**，同地域不计费） |
| 路由 | 域 A `vtb-2zeoptm97f5i4w69tz8yj`：`10.10.0.0/16 → pcc`；域 B `vtb-2zeph65z5p1iz7lw74180`：`172.16.0.0/12 → pcc` |

跨域实测（域 A → 域 B，全部 PASS）：

- teeA → teeB ICMP：2/2，0% 丢包，0.27ms;
- teeA → teeB TCP/22：通；
- LLMA → teeB ICMP：2/2，0.22ms；
- 本机经 teeA 跳板 SSH 进 teeB（`10.10.0.10/24`）：登录成功。

**API 路径踩坑记录**（控制台「更换专有网络」向导的确定按钮在自动化与人工点击下均无响应，
`ecs-console-network` 微前端提交处理器失效；最终走 OpenAPI 完成，务必记下这四条）：

1. `ecs:ModifyInstanceVpcAttribute` **必须显式传 `VpcId`**——只给 `VSwitchId` 时 API 要求新交换机与原交换机同 VPC，报 `InvalidVSwitch.NotBelongToVpc / INVALID_TARGET_VPC_AND_VSWITCH_NOT_BELONG`；
2. 安全组参数是**重复列表** `--SecurityGroupId.1`（不是 `--SecurityGroupId`），且指定 `VpcId` 时必填；
3. VPC 对等连接在**独立产品 `vpcpeer`**（不是 `vpc`），参数为 `--VpcId`（请求方）+ `--AcceptingVpcId` + `--AcceptingAliUid` + `--AcceptingRegionId`；同账号**自动接受**（创建后即 `Activated`）；
4. `ecs:AuthorizeSecurityGroup` 的 `--PortRange='-1/-1'` 必须加引号（否则 CLI 把 `-1/-1` 当选项解析，报 `InvalidParam.PortRange`）。

## 3.7 产品代码链路真机跑通（2026-10-03，替代 §3.5 的命令行工具预演）

不再用 `xdattest` 手工串，而是**仓内产品代码**走完「节点证明 → 跨域 → 校验方验签 → 背书 → 节点核验背书」：

| 环节 | 实现 | 位置 |
|---|---|---|
| 取 quote + collateral | `tdx-sidecar quote`（Go，ioctl `/dev/tdx_guest`；PCK CRL 与 TCB Info 直取 Intel PCS，带 `next_update`） | teeA（域 A） |
| 证明提供者 | `TdxAttestationProvider` + `ExecTdxQuoteSource`，经 `TEE_NODE_TDX_SIDECAR` 注入 `TeeNodeProviderRegistry.hardwareAttestation` | teeA，`tee-node` 进程 |
| 探针 | `tee-node -- probe`：报告 + 原生 quote（`evidence.quote`）经对等连接送校验方 | 域 A → 域 B |
| 校验方 | `tee-verifier -- serve`（systemd，绑 `10.10.0.10:5024`）：探针签名认证 → `sm3(quote)` 对摘要 → `tdx-sidecar verify` 验签到 Intel 证明根（collateral 自取 Intel PCS + CRL 吊销检查）→ REPORTDATA / 度量 / TCB 以原始 quote 为准比对 → 白名单与 TCB 下限 → `createHardwareAttestationVerifier` 判 collateral 新鲜度 → SM2 签背书 | teeB（域 B） |
| 节点核验背书 | `verifyEndorsementPush`（部署配置的校验方公钥）+ 绑定本节点、本次 quote | teeA |

实测结果（等级 A，`evidence/product-chain-20261003/{teeA-node.log, teeB-verifier.log}`）：

- **能力通告转真**（tasks 4.4）：`tee-node -- advertise` 输出 `tee{kind:"tdx", min_tcb:"5.1.3"}`，取自真实 quote，非配置值。
- **探针**：`accepted: true, endorsed: true`；度量 `sm3:14761963…2ce2`（= `SM3(MR_TD e0199499…568a)`），TCB `5.1.3`，背书有效期 30 分钟。
- **负例（真机）**：把 quote 翻转 1 bit 后交 `tdx-sidecar verify` → `unable to verify message digest using quote's signature`，退出码 1（校验方单测另覆盖 8 类拒绝路径）。
- **耗时**：取 quote 4ms；校验方验签（含向 Intel PCS 取料）约 3.8s。
- **产物摘要**：`tdx-sidecar` sha256 `1ab542de…0bc4`（两机一致，go-tdx-guest `e5b4626`）；`tee-node.js` `b6cc77f1…6e78`；`tee-verifier.js` `c1e5a95d…3121`；Node v20.18.1（官方 SHASUMS 核对一致）。

口径约定（两侧同源于 sidecar，校验方不信节点自报值）：`measurement = "sm3:" + SM3(MR_TD 原始 48 字节)`；`tcb = TEE_TCB_SVN 前三字节点分`。

**仍未完成**（平台登记见 §3.8，已完成）：KMS 密钥释放与 `c2-session` 端到端（tasks 4.3）——仓内目前没有可联网的 KMS 服务、节点侧远程 KMS 客户端与持有方侧密钥托付通道，均为进程内实现。D-TEE-3 ② **不升「已实测」**。

## 3.8 平台登记与上链（2026-10-03，tasks 4.5）

ali29 控制面当日发版（api `rel-20261003b`，回滚 `medtrust-api:pre-20261003`）后跑通：

1. 节点注册：`tee-node-a` 只提交公钥，平台签发证书指纹 `SM2:87D033908C543316`（响应不含私钥）。
2. 心跳：`tee-node -- heartbeat` 上报能力通告 `tee{kind:"tdx", min_tcb:"5.1.3"}`，平台注册表该节点 `online`。
3. 探针 → 校验方（teeB）背书 → 校验方直推平台 `POST /api/v1/mdop/attestations/endorsements`
   （背书签名即认证，校验方不持平台账号；DECISIONS D-TEE-6 补注）→ 平台用 `MDOP_KMS_PUBKEY` 验签、
   核校验方白名单与度量白名单后登记：`kind=tdx tcb=5.1.3 by=verifier-domain-b`。
4. 上链：长安链 tx `6b6344a0d2927292b25fc6731c7b256392c3ddf0378aa6e04ebebc793e8fa604`，block 47，
   存证摘要 = `SM3(quote_digest)`（quote 摘要 `sm3:da582da0…1e83`）。

证据（等级 A）：`evidence/product-chain-20261003/{teeB-platform-registration.log, platform-anchor.log}`。

## 3.9 端到端：两院封存 → TDX 证明 → 密钥释放 → 节点内配对 → 只出 C3（2026-10-03，tasks 4.3）

作业 `job-mur9q5ac-c7088283`（模板 `rws.paired-cohort`，合成数据，6 个阶段），终态 **SUCCEEDED**：

| 步 | 发生在哪 | 事实 |
|---|---|---|
| 合约 | 平台 + 两院 | 两份合约（示范甲、示范乙各一份）重新要约：接收方加入 `tee-node-a`，证明策略 `tee:[tdx]` / `min_tcb 5.1.3` / 度量白名单；两院签署 + 平台副署后生效 |
| 编译与凭证 | 平台 | 编译期核「节点有未过期的 TDX 证明登记」；三方接受后签发凭证，冻结节点执行环境期望（tdx / 度量 / TCB） |
| 取数与封存 | 两院连接器（ali29，隔离网络） | 各载入 5000 条 → **最小投影**（仅 1600 条带跨院关联假名的记录、5 个字段）→ AES-256-GCM 封存；数据密钥经 SM2 加密托付给密钥保管方 |
| 中继 | 平台 | 两份 C2 信封密文中继到节点（平台无解密能力） |
| 证明与释放 | teeA → teeB | 节点对本次会话真实取 TDX quote；保管方验签到 Intel 证明根并核度量 / TCB / 绑定后，用证明里的一次性公钥封回两把数据密钥（各一份签名凭据） |
| 节点内计算 | teeA（TDVM） | 解封 → `rws.paired-cohort@1.0.0`（wasm，摘要 `575c5601…384d`）→ 发布审查（minCell=5，抑制 0 格）→ 查询预算 1/5 |
| 出口 | teeA → 平台 | 只出 C3：队列 1600、暴露 1289、结局 249、暴露且结局 223，随带发布审查清单 |
| 见证与回执 | 平台 | 两条会话见证登记（`kms://verifier-domain-b`）；三方回执链各 4 条、`valid:true`；链头上链 block 53 / 54 / 55 |

**结果对拍**：与 `scripts/inject-cross-site-linkage.mjs` 事先算出的期望值四项全等。

证据（等级 A）：`openspec/changes/intel-tdx-xeon-showcase/evidence/e2e-20261003/`（作业全量记录、三处日志、合约条款、解读输出）。

**打通过程中修掉的 7 处缺陷**（此前被进程内用例掩盖，均已有代码修复）：
封存算子未进平台种子表；医院不通告封存能力；密钥保管口按接口类型注入恒为空；节点会话只认单一合约；
封存整份院内记录而非配对最小投影（字段名也对不上）；平台发件箱在副署送达前就把它清掉；
节点退避定时器被 `unref` 导致一次 502 即静默退出；节点按 URN 查不到合约里的裸参与方 id。

**如实边界**：
- 密钥保管方是**试点形态**（与校验方同进程、密钥只在内存、重启即失），不是生产 KMS；D-TEE-1 未决。
- 作业未进 `PURGED`：销毁指令已下发节点，回执未收齐。
- 分层表里各层的 `outcome` 字段为 0（顶层合计正确），属配对模块输出的已知瑕疵，未修。
- 会话见证「转发 0 个持有方」：两院尚未独立核验见证。
- 全程合成数据；跨院关联假名为人为注入。

## 3.10 第二个场景：疾控 × 医院疫苗 SCRI，以及 §3.9 三条边界的消解（2026-10-03）

在同一链路上跑通疫苗接种后不良事件主动监测（`openspec/changes/aefi-active-surveillance/`；证据 `intel-tdx-xeon-showcase/evidence/aefi-scri-20261003/`）：

- `job-murps5q9-09483c50`：区疾控（新增 `rws-worker-c`）+ 示范乙封存 → teeA 真实 TDX 证明 → teeB 释放 → 节点内 `rws.vaccine-scri`（Wasm，SM3 `d7dd3848…ab4e5a`）→ minCell 5 抑制 0 → C3 与 `data/demo/aefi/answer-key.json` 逐格一致。销毁回执被平台拒（签名口径）→ **修复**（节点/语料销毁回执改 `signCanonicalObject`）后重发销毁，作业进 **PURGED**，三节点链头上链（区块 165/167/168）。
- 见证「转发 0 个持有方」的根因：平台按合约 **recipients** 转发，而 C2 合约的接收方只有节点与平台，持有方（合约提供方）不在其中 → **修复**（转发对象补上提供方；作业视图应上报见证的节点只取凭证内的可信空间节点）。
- `job-murqxdaz-533a32d5`（修复后重跑）：疾控与示范乙连接器各自 `WITNESS_VERIFIED`（控制台「本院核验通过」），结果一致，PURGED，上链区块 179/180/181。
- 由此 §3.9 的「未进 PURGED」「转发 0 个持有方」两条已消解；配对模块分层 `outcome` 为 0 的瑕疵仍在（场景 1 专属）。

## 4. 边界与未完成

- 本记录覆盖到 tasks 4.3 / 4.5（§3.7–§3.9）。**D-TEE-3 ② 的两半解除条件（真实 quote 验签 + `c2-session` 端到端）均已有真机证据**；是否据此把 D-TEE-3 ② 升为「已实测」是决策动作（tasks 5.2），本记录不代为升级。
- 全程合成数据；未接任何患者数据（REG-08 闸门未动）。
- 实例为按量计费；冒烟完成后已于 2026-10-02 13:55 (UTC+8) **SSH `shutdown -h now` 停机**（TDX 机型系统内仅 reboot 不支持，shutdown 正常；下电耗时约 2 分钟，控制台状态滞后），停机后为**节省停机模式**（vCPU/内存停计费，公网 IP 已释放——**下次开机会换新公网 IP**，SSH 目标需更新；私网 `172.21.6.201` / 磁盘数据 / 密钥对保留）。残留费用仅系统盘 ≈¥0.3–0.5/天。
- 运维事实：控制台「停止」对话框在实例停止过渡态会把实例列入"不可操作"——判断真实状态以刷新后的实例列表为准，勿重复下发停止。
- **2026-10-02 晚状态更新（覆盖本条上文「已停机」口径）**：三台实例均已开机运行——teeA `39.105.74.95`/私网 `172.21.6.201`（域 A）、LLMA `39.107.95.197`/私网 `172.21.6.203`（域 A）、teeB `39.96.21.105`/私网 `10.10.0.10`（**域 B**，见 §3.6）。三台已配置本机公钥 `~/.ssh/medtrust-tdx-beijing`（root 免密，2026-10-02 经密码 SSH + 云助手写入；teeB 换 VPC 后公钥仍在 authorized_keys）；teeB 在域 B 的安全组已按最小权限收紧（见 §3.6）。
- **2026-10-02 收尾（当前状态）**：三台已按**节省停机模式**（`StopCharging`）关闭——`DescribeInstances` 全部 `Status=Stopped / StoppedMode=StopCharging`，**公网 IP 已释放**（三个 `39.x` 地址作废，重开换新 IP：`StartInstance` 后重新 `DescribeInstances` 取）；私网 IP、磁盘数据、authorized_keys 保留；系统盘继续计费（≈¥0.3–0.5/天/台）。停机/重建流程见 [runbook-rebuild.md](../runbook-rebuild.md) §8.0。
- **SSH 公钥配置方式（运维事实）**：LLMA 用密码写入；teeA/teeB 的 sshd 只接受 publickey 且原绑定密钥不在本机，故经**云助手**下发命令写入（InvokeId `t-bj06yszxgqa48hs`，3/3 成功，命令幂等——`grep -qF` 去重）。控制台「导入密钥对」对话框在全自动环境下因 Monaco 编辑器不渲染（1×1px）无法提交，勿在该路径上耗时。

## 5. 证据清单

| 文件 | 内容 | 等级 |
|---|---|---|
| `evidence/quote-20261002.bin` | 真实 TDX quote 原文（5006B，V5，含 PCK 证书链） | A |
| `evidence/tdx-lab-run1-pccs.log` | PCCS 源运行日志（tcbInfo 过期实证） | A |
| `evidence/tdx-lab-run2-intel-pcs.log` | Intel PCS 直取运行日志（全链验签 PASS） | A |
| `evidence/cross-domain/prove-nodeA.json` | 跨域：A 域出证元数据（REPORTDATA 装填、耗时） | A |
| `evidence/cross-domain/quote-nodeA.bin` | 跨域：A 域真实 quote（5010B，SM3 绑定装填） | A |
| `evidence/cross-domain/verdict-nodeB.json` | 跨域：B 域验签判决（链到 Intel 根 + rd_match + MRTD/TCB） | A |
| `evidence/cross-domain/released.b64` | 跨域：B 域释放的 SM2 封包会话密钥（仅绑定私钥可开） | A |
| `evidence/rerun-20261002-2315/quote.bin` | 复跑：真实 quote（5006B，V5，头部 `05000200810000…`），SM3 `34d84dbf4a37538b3b9e081836ea6972ac2efb0f267f7d4c1f099bec72faaae3` | A |
| `evidence/rerun-20261002-2315/prove.json` | 复跑：prove 元数据（一次性 SM2 公钥、`reportdata` 装填、`quote_len`、`quote_sha384`、耗时、时间戳） | A |
| `evidence/rerun-20261002-2315/pub.hex` | 复跑：一次性 SM2 公钥（`04ff5d8e…f6aad`，与 `reportdata` 前 32B 绑定） | A |
| `evidence/tdx-lab-run.json` | 复跑：`tdx-lab -json -report-data <SM3+0…0> -skip-early` 全量结果（32 项：29 pass / 1 fail=Strict TCB OutOfDate / 2 skip；含 MR_TD、TEE_TCB_SVN、RTMR、Quote V5 解析、ReportData 往返校验） | A |
| 实例控制台（i-2ze8qci4r5ec6trmywi0） | 购买单据/规格/状态（账号内可查） | B |
