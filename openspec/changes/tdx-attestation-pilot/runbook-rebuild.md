# 从零重建手册：MedTrust TDX 试点环境（两域 + 三台实例）

> **用途**：本环境是**演示/试点用**，测试完可整套删除；本手册用于**下次从零重建**，
> 面向自动化执行（kimi-webbridge + `aliyun` CLI），并标出**哪些步骤必须人工一击**。
>
> **产物**：域 A/域 B 两个 VPC（对等连接打通）+ 3 台 ECS（teeA/teeB 为 g8i TDX、LLMA 为 g9i AMX）
> + 真实 TDX quote 证据 + 跨域连通验证。
>
> **凭证**：`.secrets/aliyun.env`（**本地文件，已被 `.gitignore` 忽略，勿提交**）；
> 仓库内文档只引用路径，不复制 AK 明文。
>
> 关联记录：[evidence/RECORD.md](./evidence/RECORD.md)（实测证据）· [runbook-aliyun.md](./runbook-aliyun.md)（开机清单与 API 细节）

---

## 0. 前置条件

| 项 | 值 / 要求 |
|---|---|
| 阿里云账号 | `1432440622130600`（`ap581****@aliyun.com`，控制台 `login_aliyunid_pk` cookie 可核） |
| RAM 用户 | `teetester`，系统策略 **`AliyunECSFullAccess`** + **`AliyunVPCFullAccess`**（授权范围=整个云账号） |
| 凭证 | 放在 `.secrets/aliyun.env`（`source` 后得到 `ALIYUN_TEETESTER_AK/SK`）；**用毕删除 AK 与该文件** |
| 本地工具 | `aliyun` CLI ≥3.4.11 · kimi-webbridge（浏览器自动化）· `ssh`/`expect` · `openssl`（需支持 `sm3`）· `xxd` |
| 区域 | `cn-beijing`（华北2），可用区 **L**（换 VPC / 加交换机必须同可用区） |

```bash
source .secrets/aliyun.env
AK=$ALIYUN_TEETESTER_AK; SK=$ALIYUN_TEETESTER_SK
# 身份校验（⚠️ 必须显式传参：本机 CLI 的 default profile 可能是别的无权限用户，环境变量会被 profile 覆盖）
aliyun sts GetCallerIdentity --access-key-id $AK --access-key-secret $SK   # 期望 Arn ...:user/teetester
```

**自动化边界（先看这条，能省掉大量试错）**

| 能做（自动化） | 不能做（必须人工一击） |
|---|---|
| 所有 OpenAPI（`aliyun` CLI） | 阿里云控制台 **Fusion 模态框的按钮**（如「更换专有网络」向导的 `确定`）——JS 点击 / CDP 真鼠标 / React fiber `onClick` 全部无效，人工点击亦无响应（微前端提交处理器失效） |
| ECS 购买页（antd 组件：tab、下拉、模糊搜索、卡片） | 「导入密钥对」对话框的 **Monaco 编辑器**在无头环境渲染成 1×1px，提交不可靠 |
| 读页面状态（`evaluate` 读 DOM / `login_aliyunid_pk`） | 需要真人在场确认的支付/协议类弹窗 |
| 云助手（`RunCommand`）下发 shell —— **无需 SSH/密码** | — |
| React 受控字段：直接调 fiber 的 `onChange`（下拉）/ 原生 setter+`input` 事件（输入框） | — |

---

## 1. 网络：两域 + 安全组

域 A 沿用账号默认 VPC；域 B 新建（网段**不得与域 A 重叠**——域 A 是 `172.16.0.0/12`，故域 B 用 `10.10.0.0/16`）。

```bash
# 1.1 域 B：VPC + 交换机（交换机可用区必须与后续实例可用区一致 → cn-beijing-l）
aliyun vpc CreateVpc     --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --CidrBlock 10.10.0.0/16 --VpcName vpc-medtrust-domainb
aliyun vpc CreateVSwitch --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --CidrBlock 10.10.0.0/24 --VpcId <域B> --ZoneId cn-beijing-l --VSwitchName vsw-domainb-tee

# 1.2 域 B 安全组（安全组是 VPC 级资源，必须在新 VPC 新建）
aliyun ecs CreateSecurityGroup --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --VpcId <域B> --SecurityGroupName sg-domainb-tee

# 1.3 跨域放行（域 A 网段 → 域 B）⚠️ PortRange 必须加引号
aliyun ecs AuthorizeSecurityGroup --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --SecurityGroupId <域B安全组> --IpProtocol all --PortRange='-1/-1' \
  --SourceCidrIp 172.16.0.0/12 --Description domain-A-cross-vpc

# 1.4 按最小权限删掉控制台默认规则（80/443 对 0.0.0.0/0、ICMP 对 0.0.0.0/0、一批 RDP 3389）
for spec in "tcp 80/80 0.0.0.0/0" "tcp 443/443 0.0.0.0/0" "icmp -1/-1 0.0.0.0/0"; do
  set -- $spec
  aliyun ecs RevokeSecurityGroup --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
    --SecurityGroupId <域B安全组> --IpProtocol "$1" --PortRange="$2" --SourceCidrIp "$3"
done
# RDP 逐条 revoke（来源逐个列出，本次 6 条）；收紧后复测跨域 SSH 仍通
aliyun ecs DescribeSecurityGroupAttribute --access-key-id $AK --access-key-secret $SK \
  --RegionId cn-beijing --SecurityGroupId <域B安全组>   # 期望 ingress 仅 7 条
```

## 2. 三台实例

| 角色 | 规格 | 镜像 | 网络 | 说明 |
|---|---|---|---|---|
| **teeA** | `ecs.g8i.xlarge`（4C/16G） | Alibaba Cloud Linux 3.2104 LTS 64位 **UEFI** | 域 A | **购买页必须勾选「机密虚拟机 / TDX 安全增强」** |
| **teeB** | `ecs.g8i.xlarge` | 同上 | 先域 A，随后迁域 B（§4） | 同上 |
| **LLMA** | `ecs.g9i.large`（2C/8G，Xeon 6 **AMX**） | Ubuntu 24.04 64位 | 域 A | 推理节点；公网**按使用流量 100Mbps** |

购买页自动化要点（kimi-webbridge，均实测可用）：

1. 进入 `https://ecs-buy.aliyun.com/ecs#/custom/postpay/cn-beijing`（**postpay = 按量付费**；prepay 是包年包月）；
2. 地域 tab 点「华北2（北京）」——**切换地域会把 VPC/交换机重置**，之后必须重新确认；
3. **VPC/交换机**：域 A 的默认 VPC/交换机通常自动选中（核对 `vpc-2zeolki3…` / `vsw-2zebtm46…`）；为空时点选择器：Fusion 下拉选项在无头环境常被渲染到视口外，**用 fiber `onChange(value,{value,label})` 设值**（见 §10）；
4. 规格：模糊搜索框输入 `g9i` / `g8i`，点行内选择；
5. 镜像：先点 OS 卡片（Alibaba Cloud Linux / Ubuntu），再开「请选择版本」下拉选具体版本（卡片点击需真正生效，合成点击可能只当筛选器）；
6. 公网：勾「分配公网 IPv4 地址」→ 计费模式「按使用流量」→ 带宽峰值 `100`；
7. 安全组：选目标 VPC 下的安全组（新建实例默认给 VPC 默认组；跨域节点用 §1.2 的组）；
8. 登录凭证：**自定义密码**（teeA/teeB 建议设密码，便于首次灌公钥；密码为 3 类字符以上、12+ 位）；
9. 确认下单 → 页面出现「创建成功 实例ID：i-…」。

> 也可以走 `RunInstances` 全 API 化，但**「机密虚拟机（TDX）」是购买页的安全增强选项**，
> 用 API 前须先确认该参数名与取值（本次未验证），保守做法：tee 两台走控制台、LLMA 走控制台或 API。

## 3. 访问与公钥（三台）

```bash
# 3.1 LLMA：密码 SSH → 写入本机公钥（幂等）
PUB=$(cat ~/.ssh/medtrust-tdx-beijing.pub)
CMD="mkdir -p /root/.ssh && chmod 700 /root/.ssh && touch /root/.ssh/authorized_keys && \
     grep -qF medtrust-tdx-pilot /root/.ssh/authorized_keys || echo '$PUB' >> /root/.ssh/authorized_keys; \
     chmod 600 /root/.ssh/authorized_keys; echo INSTALLED_OK"
# 用 expect 驱动密码交互（本机无 sshpass 时）：
#   spawn ssh -o PubkeyAuthentication=no root@<LLMA公网> $CMD  → expect "password:" → send "<密码>"

# 3.2 teeA/teeB：sshd 可能只接受 publickey → 走**云助手**，无需 SSH/密码
aliyun ecs RunCommand --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --Type RunShellScript --ContentType PlainText \
  --InstanceId.1 <teeA> --InstanceId.2 <teeB> --CommandContent "$CMD"
# 查结果：aliyun ecs DescribeInvocationResults --InvokeId <t-…>
# 本次 InvokeId t-bj06yszxgqa48hs：总计 3 / 完成 3 / 失败 0

# 3.3 三台验证
for ip in <teeA公网> <teeB公网> <LLMA公网>; do
  ssh -i ~/.ssh/medtrust-tdx-beijing -o BatchMode=yes -o StrictHostKeyChecking=no root@$ip 'echo OK; hostname'
done
```

## 4. teeB 换域（域 A → 域 B）

```bash
aliyun ecs StopInstance --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --InstanceId <teeB>
# ⚠️ 控制台「更换专有网络」向导点不动（见 §0 边界）→ 走 API，且必须显式 --VpcId
aliyun ecs ModifyInstanceVpcAttribute --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --InstanceId <teeB> --VpcId <域B> --VSwitchId <域B交换机> \
  --SecurityGroupId.1 <域B安全组> --PrivateIpAddress 10.10.0.10
aliyun ecs StartInstance --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --InstanceId <teeB>
# 核对：DescribeInstances → Vpc/VSwitch/PrivateIp/SG 全部应为域 B
```

> `--SecurityGroupId.1` 是**重复列表**写法；只给 `VSwitchId` 不给 `VpcId` 会报
> `InvalidVSwitch.NotBelongToVpc / INVALID_TARGET_VPC_AND_VSWITCH_NOT_BELONG`。

## 5. 对等连接 + 双向路由

```bash
# 5.1 对等连接（独立产品 vpcpeer，不在 vpc 下；同账号自动接受 → Activated）
aliyun vpcpeer CreateVpcPeerConnection --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing \
  --VpcId <域A> --AcceptingRegionId cn-beijing --AcceptingVpcId <域B> \
  --AcceptingAliUid $ALIYUN_ACCOUNT_ID --Name medtrust-domain-a-b

# 5.2 取两侧路由表
aliyun vpc DescribeRouteTableList --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --VpcId <域A>
aliyun vpc DescribeRouteTableList --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --VpcId <域B>

# 5.3 双向路由（NextHopType=VpcPeer，NextHopId=对等连接 ID；⚠️ CreateRouteEntry 没有 --Name 参数）
aliyun vpc CreateRouteEntry ... --RouteTableId <域A路由表> --DestinationCidrBlock 10.10.0.0/16 --NextHopId <pcc> --NextHopType VpcPeer
aliyun vpc CreateRouteEntry ... --RouteTableId <域B路由表> --DestinationCidrBlock 172.16.0.0/12 --NextHopId <pcc> --NextHopType VpcPeer
```

## 6. TDX 真实证明（在 teeA/teeB 上）

```bash
# 6.1 环境探测（Alinux3 内核 5.10：只有 ioctl 路径）
grep -o -m1 tdx_guest /proc/cpuinfo; ls /dev/tdx_guest; lsmod | grep -E 'tdx_guest|tsm'
ls /sys/kernel/config/tsm/report 2>/dev/null || echo "无 configfs-tsm（正常，走 ioctl）"

# 6.2 工具：anolis/go-tdx-guest 源码构建（需要 go），产出 tools/tdx-lab 与 tools/xdattest
#     本次实例 /root/go-tdx-guest 已有构建产物，可直接复用；重建见上游 README

# 6.3 出证（一次性 SM2 密钥 + REPORTDATA 装填约定：前 32B=SM3 摘要、其余置零）
RD=$(printf "medtrust-tdx-pilot-<日期>" | openssl dgst -sm3 -binary | xxd -p -c 64)
RD64="${RD}0000000000000000000000000000000000000000000000000000000000000000"
/root/xdattest prove -out /root/medtrust-evid-$(date +%Y%m%d-%H%M%S)   # 产出 quote.bin/prove.json/pub.hex/priv.hex

# 6.4 全量报告（含 MR_TD / TEE_TCB_SVN / RTMR / Quote V5 解析 / ReportData 往返校验）
/root/go-tdx-guest/tools/tdx-lab/tdx-lab -json -report-data "$RD64" -skip-early > /root/tdx-lab-run.json

# 6.5 摘要入库
openssl dgst -sm3 -binary quote.bin | xxd -p -c 64      # SM3
sha256sum quote.bin; xxd -p -l 16 quote.bin             # 头部应以 05000200810000 开头（V5）
```

**预期结果与已知事实**：quote ≈**5006B / V5**；`MR_TD=e0199499…568a`；`TEE_TCB_SVN=5.1.3`；
`Full verification with collateral` **PASS**（链验到 Intel 证明根，~1.7s）；
`Strict TCB check` **FAIL 属预期**（平台 TCB=OutOfDate）。

**collateral 取料坑**：北京 PCCS（`sgx-dcap-server-vpc.cn-beijing.aliyuncs.com`）的 `tcbInfo`
**已过期** → 会全挂 `tcbInfo has expired`；**改直连 Intel PCS 取料即通过**。实现里必须支持
源切换/降级（PCCS ↔ Intel PCS），并保留 `fetched_at`/`next_update` 做时效判定。

## 7. 验证清单（全部应通过）

- [ ] 三台 `ssh -i ~/.ssh/medtrust-tdx-beijing root@<ip> hostname` 均返回主机名；
- [ ] teeA/teeB：`tdx_guest` flag + `/dev/tdx_guest` + dmesg `Memory Encryption Features active: Intel TDX`；
- [ ] 跨域：teeA → teeB `ping` 0% 丢包、TCP/22 通；`ssh -J root@<teeA公网> root@10.10.0.10` 登录成功；
- [ ] 域 B 安全组 ingress = 7 条（跨域 ALL + 22 端口来源），无 80/443/ICMP/RDP 全网规则；
- [ ] TDX 证据：quote 文件 + `tdx-lab-run.json` 入库到 `evidence/`，SM3/SHA256 与头部记录在案。

## 8. 拆除（测试完执行，避免持续计费）

```bash
# 8.1 释放实例（按量付费停机仍收系统盘费；释放才停止计费）
for id in <teeA> <teeB> <LLMA>; do
  aliyun ecs StopInstance   --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --InstanceId $id
  aliyun ecs DeleteInstance --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --InstanceId $id --Force true
done
# 8.2 拆网络（顺序：路由 → 对等连接 → 安全组 → 交换机 → VPC）
aliyun vpc DeleteRouteEntry ...            # 两侧各删一条
aliyun vpcpeer DeleteVpcPeerConnection --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --InstanceId <pcc>
aliyun ecs DeleteSecurityGroup --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --SecurityGroupId <域B安全组>
aliyun vpc DeleteVSwitch --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --VSwitchId <域B交换机>
aliyun vpc DeleteVpc     --access-key-id $AK --access-key-secret $SK --RegionId cn-beijing --VpcId <域B>
# 8.3 撤销凭证：RAM 控制台删除/禁用 teetester 的 AccessKey（或整个用户），并删本地 .secrets/aliyun.env
rm -f .secrets/aliyun.env
```

## 9. 交给 kimi-bridge 的启动指令（可粘贴）

> 按 `openspec/changes/tdx-attestation-pilot/runbook-rebuild.md` 从零重建 TDX 试点环境：
> 先 `source .secrets/aliyun.env` 并用 `--access-key-id/--access-key-secret` 显式传参跑 `aliyun` CLI；
> 网络与实例可走 API（tee 两台若走控制台购买页，记得勾「机密虚拟机」）；
> **遇到控制台 Fusion 模态框按钮（如「更换专有网络」的确定）直接改走 OpenAPI**；
> 三台实例的公钥用云助手（`RunCommand`）写入；最后按 §7 清单自检并把 TDX 证据落到 `evidence/`。

## 10. 自动化踩坑总表（本次实测）

| 现象 | 根因 | 正解 |
|---|---|---|
| 控制台「确定」点了没反应、无任何请求 | `ecs-console-network` 微前端提交处理器失效（人工点击同样无效） | 改走 OpenAPI（§4） |
| 环境变量里的 AK 不生效、身份始终是别的用户 | 本机 `aliyun` CLI 的 `default` profile 覆盖环境变量 | **每条命令显式传** `--access-key-id/--access-key-secret`；先 `sts GetCallerIdentity` 校验 |
| `InvalidVSwitch.NotBelongToVpc` | `ModifyInstanceVpcAttribute` 未传 `VpcId` | 显式 `--VpcId <目标VPC>` |
| `InvalidParam.PortRange` | CLI 把 `-1/-1` 当选项 | `--PortRange='-1/-1'` 加引号 |
| 找不到对等连接 API | 它是独立产品 | `aliyun vpcpeer …`（参数 `--AcceptingVpcId/--AcceptingAliUid`） |
| Fusion 下拉选项坐标 `-9998` 点不到 | 无头环境下面板渲染到视口外 | 取 `__reactInternalInstance$` fiber → 调 `memoizedProps.onChange(value,{value,label})`；Input 类组件则调 `onChange({target:{value}})` |
| 密钥对「导入」对话框提交不了 | Monaco 编辑器渲染成 1×1px | 放弃该路径：用**云助手**或密码 SSH 写 `authorized_keys` |
| 合成点击卡片无效果 | 卡片只是筛选器/需要真事件 | 先点卡片再开版本下拉；必要时用 CDP 真事件（`Input.dispatchMouseEvent`） |
| 地域 tab 切换后 VPC/交换机被重置 | 页面回到目标地域默认网络 | 切完地域后**重新确认** VPC/交换机/规格 |

## 附录 A：本次实际资源 ID（2026-10-02 建成）

| 资源 | ID |
|---|---|
| 域 A VPC | `vpc-2zeolki31xtoffgegdm3d`（172.16.0.0/12，默认 VPC）· 交换机 `vsw-2zebtm46clqi6q80hhgse` · 路由表 `vtb-2zeoptm97f5i4w69tz8yj` |
| 域 B VPC | `vpc-2zevz3jdj63wvr4tz5yr2`（10.10.0.0/16）· 交换机 `vsw-2zelabsfpcezvvcqzh1ne`（cn-beijing-l）· 安全组 `sg-2zeemp3q00i5os13e2m8` · 路由表 `vtb-2zeph65z5p1iz7lw74180` |
| teeA | `i-2ze8qci4r5ec6trmywi0` · 私网 `172.21.6.201` · 公网 `39.105.74.95` |
| teeB | `i-2zegnqenh9yx2e0g2c8o` · 私网 `10.10.0.10`（域 B） · 公网 `39.96.21.105` |
| LLMA | `i-2ze08mpxq8bxty8exbuj` · 私网 `172.21.6.203` · 公网 `39.107.95.197` |
| 对等连接 | `pcc-k4kg47h5r5d2gkp0c6`（`medtrust-domain-a-b`，Activated） |
| SSH 密钥 | `~/.ssh/medtrust-tdx-beijing`（pubkey 注释 `medtrust-tdx-pilot`） |

## 附录 B：成本与计费

- teeA/teeB：`ecs.g8i.xlarge` 按量 ≈¥1.09/时/台（TDX 机型）；LLMA：`ecs.g9i.large` ≈¥0.50/时。
- 公网**按使用流量**：¥0.8/GB（EIP/固定公网均按此计）；峰值带宽不额外计费。
- **停机 ≠ 停止计费**：节省停机模式停 vCPU/内存，系统盘继续计费（≈¥0.3–0.5/天/台）；彻底止损要**释放实例**。
- 对等连接：**同地域不计费**；跨地域才按带宽/流量计。
