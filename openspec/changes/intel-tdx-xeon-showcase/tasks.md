> 全程合成数据。场景 1 的实现任务在 `tdx-attestation-pilot`，此处只列依赖与取证。
> 先做第 1–3 组（场景 2，独立可交付），第 4 组并行。

## 1. LLMA 推理服务（运维）

- [x] 1.1 LLMA 安装运行时（docker 或 OVMS 二进制），记录 OS / 内核 / CPU flags（AMX）入证据
- [x] 1.2 取最小量化模型（首选 OpenVINO 预转换 Qwen3-0.6B int4；核实实际可得的模型名），记录模型名、量化、digest
- [x] 1.3 启动 OVMS，仅监听 `127.0.0.1:8000`；`/v3/chat/completions` 冒烟通过，保存启动日志与一次响应
- [x] 1.4 设为 systemd 服务，重启后自动拉起
- [x] 1.5 ali29 → LLMA SSH 隧道：专用密钥 + LLMA 侧 `permitopen` 限制；ali29 上 systemd 常驻转发到 `172.17.0.1:18000`；api 容器内 curl 通
- [ ] 1.6 （需控制台或 ECS 权限，未做）LLMA 安全组收口：入方向只留 22（ali29 + 运维来源），域 B 与公网其余来源拒绝；从公网与 teeB 各验证一次 8000 / 22 不可达并留证
- [ ] 1.7 （未绑 EIP；换 IP 后的步骤已写进 DEPLOY §4.4）LLMA 绑固定 EIP，或在 DEPLOY 写明开机后更新隧道目标的步骤

## 2. 控制面接入（apps/api）

- [x] 2.1 新模块 `result-interpreter`：独立 `RESULT_INTERPRETER_LLM_*` 配置，自托管端点无 key 可用；任务设计助手不动
- [x] 2.2 响应附带实际供应商与模型；端点未配置 / 不可用返回 503，不回落（单测覆盖）
- [x] 2.3 解读接口：入参聚合字段白名单（非 C3 即 400 且不调模型）、输出带草稿标注（单测覆盖正例 + 拒收负例）
- [x] 2.3b 解读防错：派生量由服务端预先算好；输出数字回查（清单外数值即 422）；剥离思考段（单测覆盖 design S3 实测的错误）
- [x] 2.4 用 LLMA 真实端点跑通两类样例（配对队列 11.4s、失衡检测 6.4s），结果记入 design S5

## 3. 前端与治理同步

- [x] 3.1 web：MDOP 作业详情页加「结果解读」面板（事实清单与草稿并排、显示供应商 / 模型、草稿标注）；白名单挑字段有单测
- [x] 3.2 AGENT.md：新登记 AGT-04（control-plane，data-access none，vendor self-hosted-openvino）
- [x] 3.3 FLOWS.md 新增 FLOW-AI-04；DECISIONS.md 新增 D-AI-2；TRUST.md CTL-11 注记适用范围
- [x] 3.4 `tdx-attestation-pilot/external-claims.md`：两处「vLLM + IPEX-LLM」改 OpenVINO，推理机型按实测 Xeon 6 6982P-C 回填
- [x] 3.5 DEPLOY.md 增 LLMA 一节（私网地址、启动方式、隧道、`RESULT_INTERPRETER_LLM_*`）
- [x] 3.6 上线 ali29：留回滚镜像标签；`apps/api/.env` 加 `RESULT_INTERPRETER_LLM_*`；重建 api / web 必须带 `-f compose.yaml -f compose.hardening.yaml`
- [x] 3.7 `node scripts/check-meta-docs.mjs` 0 error、`pnpm test` 绿、`openspec validate --strict intel-tdx-xeon-showcase` valid

## 4. 场景 1 依赖与角色落位

- [x] 4.1 `tdx-attestation-pilot` 1.2 / 2.2 / 2.4 完成（teeA 节点运行时 + 真实 quote source 接线）
- [x] 4.2 `tdx-attestation-pilot` 3.1–3.3 完成（teeB 侧 TDX 信任根与校验器，Intel PCS 直取 collateral）
- [x] 4.3 `tdx-attestation-pilot` 4.1–4.5 完成（两院合成数据 `c2-session` 端到端：证明 → 释放 → 执行 → 只出 C3 → 回执 → 上链）
- [ ] 4.4 （需控制台或 ECS 权限，未做）跨域边收紧：域 A / 域 B 安全组从 ALL 收到场景 1 实际端口 + 22；收紧前后各留一份连通性证据，端到端重跑仍通过
- [x] 4.5 场景串联：场景 1 产出的 C3 结果经 2.3 的解读接口走 LLMA，形成一条完整演示链

## 5. 取证与截图

- [x] 5.1 写截图清单（`evidence/shotlist.md`）：每条含画面、机器、证据文件、采集时间
- [x] 5.2 场景 2 截图：OVMS 启动日志（AMX / 模型）、作业结果页的解读面板（事实清单 + 草稿）、公网不可达验证
- [x] 5.3 场景 1 截图：两域拓扑（两个 VPC + 对等连接）、teeA TDX 自检与 quote 产出、teeB 验签到 Intel 根的判决、密钥释放、平台任务页、C3 结果、`chain_tx`
- [x] 5.4 截图中不出现口令、密钥、公网 IP；合成数据标注到位

## 6. 宣传视频

- [x] 6.1 分镜与旁白稿（2–3 分钟，按场景分页）；对照 `external-claims.md` 两栏逐句自查 + `check-tee-claims.mjs`
- [x] 6.2 在 `video/` 新建独立成片的 composition 与场景帧表（与 `Root.tsx` 时长同步）
- [x] 6.3 TTS 配音 + 按页渲染（`node scripts/render-scenes.mjs`），出 4K 母带与 1080p 交付版
- [x] 6.4 成片复核：画面逐条对上 5.1 清单；无性能数字、无未用硬件、合成数据明示
