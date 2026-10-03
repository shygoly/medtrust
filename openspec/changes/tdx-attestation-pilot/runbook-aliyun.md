# 阿里云开机清单（已落地形态：**两域（L1）** + 按量付费 + 无 VPN + 无 B70）

> 对应变更 [tdx-attestation-pilot](./tasks.md) 的任务 1.1 / 1.2 / 2.4 / 4.x 的**运维前置**。
> 推理侧 = 至强 AMX CPU 推理（vLLM + IPEX-LLM），可信侧 = g8i TDX 机密虚拟机。
> 官方文档：[构建 TDX 机密计算环境](https://help.aliyun.com/zh/ecs/user-guide/build-a-tdx-confidential-computing-environment) ·
> [阿里云远程证明服务](https://help.aliyun.com/zh/ecs/user-guide/remote-attestation-service)（支持 Intel TDX，可作校验方）。
>
> **2026-10-02 更新**：单一 VPC 的初版（A 案）已升级为**两域 L1**（teeB 迁入独立 VPC + 对等连接），
> 目的是让「跨域数据汇集」具备真实的网络域分离前提。已落地实况与 API 操作见本文 §L1。
>
> **要从零重建整套环境（测试完删除后重来）请看 [runbook-rebuild.md](./runbook-rebuild.md)**：
> 面向自动化（kimi-webbridge + `aliyun` CLI）的完整步骤、必人工一击的环节、踩坑总表、拆除清单，
> 以及实际资源 ID 附录。凭证在本地 `.secrets/aliyun.env`（gitignore，不入库）。

## 拓扑（已落地：2 VPC + 对等连接 + 3 ECS）

```
域 A  vpc-2zeolki31xtoffgegdm3d (172.16.0.0/12)
 ├─ teeA  172.21.6.201   g8i TDX 机密虚拟机（运行中，公网 39.105.74.95）
 └─ LLMA  172.21.6.203   g9i（Xeon 6 AMX）推理节点（运行中，公网 39.107.95.197）
        ▲
        │ 对等连接 pcc-k4kg47h5r5d2gkp0c6（同地域，不计费）
        │ 路由：域A → 10.10.0.0/16 ／ 域B → 172.16.0.0/12
        ▼
域 B  vpc-2zevz3jdj63wvr4tz5yr2 (10.10.0.0/16)
 └─ teeB  10.10.0.10     g8i TDX 机密虚拟机（运行中，公网 39.96.21.105）
```


## 采购与开机步骤

1. **网络**：建 VPC + vSwitch（两机同可用区）；EIP 计费方式选**按使用流量**。
2. **安全组**：
   - `SG-tdx`：入方向仅 22/tcp 限源（办公/跳板 IP）；出方向 443（Intel PCS / 阿里云 API）。
   - `SG-infer`：**不绑 EIP、不开公网**；入方向 8000/tcp 仅允许 `SG-tdx`（或 node-tdx 私网 IP）。
3. **node-tdx（先开这台）**：g8i 规格族、**按量付费**、购买页勾选**机密虚拟机（TDX/安全增强）**选项；
   镜像按[官方 TDX 文档](https://help.aliyun.com/zh/ecs/user-guide/build-a-tdx-confidential-computing-environment)要求（TDX 内核/机密计算镜像）；系统盘 ESSD ≥ 60G。
4. **TDX 生效验证**（= 任务 1.1「四事实入账」入口）：按官方文档示例跑一次 quote 生成；
   记录四个部署事实进实测记录：**机型 SKU / region / TDX module 版本 / TCB 版本**（TCB 取自真实 quote，不得手填）。
5. **node-infer**：g9i.2xlarge 起、按量、同 VPC；Ubuntu 24.04；装 Intel 栈
   （[容器化 vLLM 全栈](https://www.eet-china.com/mp/a490407.html) 或 IPEX-LLM CPU 后端），模型 Qwen3-4B/8B 量级；
   `vllm serve ... --host <私网IP> --port 8000`。
6. **验收**：
   - [ ] node-tdx 内 `curl http://<node-infer 私网IP>:8000/v1/models` 返回模型列表；
   - [ ] node-infer 从公网不可达（无 EIP、安全组无公网入）；
   - [ ] TDX 示例 quote 跑通，四事实入账；
   - [ ] `tee-node serve`（真实 quote 接通前 software 模式）心跳正常、能力通告 `tee: null`（如实，不虚标）。

## §L1 两域已落地操作（2026-10-02，可复跑）

> 实测记录见 [evidence/RECORD.md](./evidence/RECORD.md) §3.6。**凭证用显式传参**：
> 本机 `aliyun` CLI 的 `default` profile 可能是无权限用户（环境变量会被 profile 覆盖，别用 `export`）。

```bash
AK=<AccessKeyId>; SK=<AccessKeySecret>   # 每条命令都带 --access-key-id $AK --access-key-secret $SK

# 1) 域 B：VPC + 同可用区交换机（换 VPC 的硬要求：交换机与实例同可用区）
aliyun vpc CreateVpc    --RegionId cn-beijing --CidrBlock 10.10.0.0/16 --VpcName vpc-medtrust-domainb
aliyun vpc CreateVSwitch --RegionId cn-beijing --CidrBlock 10.10.0.0/24 --VpcId <域B> --ZoneId cn-beijing-l --VSwitchName vsw-domainb-tee

# 2) 域 B 安全组（安全组是 VPC 级资源，必须在新 VPC 新建）
aliyun ecs CreateSecurityGroup --RegionId cn-beijing --VpcId <域B> --SecurityGroupName sg-domainb-tee

# 3) teeB 换 VPC —— ⚠️ 控制台「更换专有网络」向导的确定按钮点不动（ecs-console-network
#    微前端的提交处理器失效，人工点击同样无响应），走 OpenAPI：
aliyun ecs ModifyInstanceVpcAttribute --RegionId cn-beijing \
  --InstanceId i-2zegnqenh9yx2e0g2c8o \
  --VpcId <域B> --VSwitchId <域B交换机> \
  --SecurityGroupId.1 <域B安全组> --PrivateIpAddress 10.10.0.10
#   ⚠️ 必须显式 --VpcId（只给 VSwitchId 时 API 要求新交换机与原交换机同 VPC →
#      InvalidVSwitch.NotBelongToVpc / INVALID_TARGET_VPC_AND_VSWITCH_NOT_BELONG）
#   ⚠️ 安全组是重复列表 --SecurityGroupId.1（不是 --SecurityGroupId）

# 4) 跨域放行（域 A 网段 → 域 B 安全组）
aliyun ecs AuthorizeSecurityGroup --RegionId cn-beijing --SecurityGroupId <域B安全组> \
  --IpProtocol all --PortRange='-1/-1' --SourceCidrIp 172.16.0.0/12 --Description domain-A-cross-vpc
#   ⚠️ --PortRange='-1/-1' 必须加引号（否则 CLI 当选项解析 → InvalidParam.PortRange）

# 5) 对等连接（独立产品 vpcpeer，不在 vpc 下）
aliyun vpcpeer CreateVpcPeerConnection --RegionId cn-beijing --VpcId <域A> \
  --AcceptingRegionId cn-beijing --AcceptingVpcId <域B> --AcceptingAliUid <账号ID> --Name medtrust-domain-a-b
#   同账号自动接受 → Status=Activated；跨账号需再调 AcceptVpcPeerConnection

# 6) 双向路由（路由表用 DescribeRouteTableList --VpcId <id> 取）
aliyun vpc CreateRouteEntry --RegionId cn-beijing --RouteTableId <域A路由表> \
  --DestinationCidrBlock 10.10.0.0/16  --NextHopId <pcc-id> --NextHopType VpcPeer
aliyun vpc CreateRouteEntry --RegionId cn-beijing --RouteTableId <域B路由表> \
  --DestinationCidrBlock 172.16.0.0/12  --NextHopId <pcc-id> --NextHopType VpcPeer

# 7) 启动 + 验证
aliyun ecs StartInstance --RegionId cn-beijing --InstanceId <teeB>
ssh -J root@<teeA公网> root@10.10.0.10          # 跨域 SSH（teeA 跳板，密钥已装）
#   或从 teeA 内：ping 10.10.0.10 / nc -z 10.10.0.10 22
```

**安全组收紧（最小权限）**：新建安全组会带控制台默认模板（80/443 对 `0.0.0.0/0`、ICMP 对 `0.0.0.0/0`、
一批 RDP 3389）。Linux 节点上按最小权限删掉这些，保留「跨域 `172.16.0.0/12` ALL」+「22 端口指定来源」：

```bash
for spec in "tcp 80/80 0.0.0.0/0" "tcp 443/443 0.0.0.0/0" "icmp -1/-1 0.0.0.0/0"; do
  set -- $spec
  aliyun ecs RevokeSecurityGroup --RegionId cn-beijing --SecurityGroupId <域B安全组> \
    --IpProtocol "$1" --PortRange="$2" --SourceCidrIp "$3"
done
# 3389 同理逐条 revoke（来源逐个列出）；收紧后复测跨域 SSH 仍通（实测 PASS）
```

## collateral / 校验方三选一（design P3）

| 选项 | 说明 | 适用 |
|---|---|---|
| ① Intel PCS 公网直取 | 云上默认形态，node-tdx 出方向 443 即可 | **试点首选，零部署** |
| ② 阿里云远程证明服务 | 托管校验方（支持 TDX），可当任务 4.5 的背书校验方 | 证明登记链想省自建时 |
| ③ VPC 内自托管 PCCS/Trustee | 完全自持 | 生产/院内路径预演 |

## 成本（以官网价为准，量级参考）

两台 2xlarge 按量 ≈ 每小时几元；一次 demo 3–5 小时 + EIP 流量 ≈ **¥20–50/次**。跑完即释放，只留快照/镜像（任务 1.2 镜像 digest 记录）。

## 红线（与变更 spec 一致）

- 真实 TDX quote 接通前：能力通告恒 `tee: null`、`attestationLevel` 恒 `software`（D9 / CTL-09）。
- 对外表述上限：「已在云上 TDX 机型完成一次真实证明的端到端验证（合成数据）」——见 external-claims.md（任务 5.5）。

## 附注：gn8v-tee 备选（本期不采用）

阿里云另有 [gn8v-tee 异构机密实例（Intel TDX + NVIDIA GPU 机密计算）](https://help.aliyun.com/zh/ecs/user-guide/build-a-heterogeneous-confidential-computing-environment)，
官方甚至有 [OpenClaw 机密 AI Agent 教程](https://help.aliyun.com/zh/ecs/user-guide/build-openclaw-confidential-ai-agent-on-heterogeneous-confidential-computing-instances)——
若未来要「推理也在机密域」可切换，但 GPU 是 NVIDIA，不满足全 Intel 叙事；A 案不用，仅作 roadmap 记录。
