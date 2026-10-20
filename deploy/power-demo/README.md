# 河南电力可信数据空间演示

这个目录包含电力空间的合成时序数据、三个连接器的本地策略、部署示例和端到端脚本。

## 场景

| 场景 | 模板 | 节点 |
|---|---|---|
| 负荷预测 | `power.load-forecast` | p-grid-hn / p-market-hn / p-res-hn |
| 需求响应 | `power.demand-response` | p-grid-hn / p-market-hn / p-res-hn |
| 窃电检测 | `power.theft-detection` | p-grid-hn / p-market-hn / p-res-hn |

## 前置条件

1. 控制面已启用电力包，并创建电力空间：
   - `SPACE_PACKS=med,power`
   - `POWER_MDOP_DEMO_SEED=true` 创建 6 个电力演示产品与电力账号
   - `POWER_MDOP_DEMO_ACL=false`（演示 ACL 由本目录脚本显式授予）
2. 控制面与 Postgres 可从连接器网络访问。
3. 三个连接器已在平台注册证书。

## 数据

`data/` 下已包含 6 个 CSV（35 天、10 块表、小时级）：

- `load.csv`：正常日负荷曲线，用于负荷预测和需求响应。
- `theft.csv`：6 块异常表 + 4 块正常表，用于窃电检测。

重新生成：

```bash
python3 generate_data.py
```

## 启动连接器

1. 生成连接器密钥（私钥只留在本地）：

```bash
node apps/connector/scripts/keygen.mjs --out deploy/power-demo/keys/power-grid.key
# market / plant 同理
```

2. 注册公钥并取得证书指纹：

```bash
node apps/connector/scripts/register.mjs \
  --connector-id cn-power-grid \
  --participant-id p-grid-hn \
  --token <operator-jwt>
```

3. 复制 env 示例并填写：

```bash
cp env/grid.env.example env/grid.env
cp env/market.env.example env/market.env
cp env/plant.env.example env/plant.env
```

必须替换：数据库口令、证书指纹、平台三把公钥、本地管理令牌、假名密钥。

4. 启动：

```bash
docker compose -f compose.power-demo.yaml up -d
```

默认网络为 `medtrust_default`，可用 `POWER_DEMO_NETWORK` 覆盖。

## 手工授权与合约

生产启用时 **不会** 自动授予 ACL 或合约。本演示使用显式脚本：

```bash
export POWER_API_BASE=http://127.0.0.1:5021/api/v1
export POWER_DEMO_PASSWORD=demo123456
# 如测试环境账号密码不同，可分别设置：
# export POWER_CONSUMER_PASSWORD=...
# export POWER_OPS_PASSWORD=...
# export POWER_PROVIDER_PASSWORD=...

python3 scripts/bootstrap_acl.py
python3 scripts/bootstrap_contracts.py
```

- `bootstrap_acl.py`：运营方为 `p-power-analyst` 授予 6 个产品的 `catalog+compute`。
- `bootstrap_contracts.py`：三个提供方逐产品创建合约并发送 MDOP 要约；连接器按 `policies/*.json` 自动签署。
- 合约 ID 写入 `runtime/contracts.json`（已 gitignore）。

## 跑场景

```bash
python3 scripts/run_scenario.py load
python3 scripts/run_scenario.py dr
python3 scripts/run_scenario.py theft --threshold 0.5
```

脚本会完成：模板预览 → 提交作业 → 编译 → 轮询 → 打印结果。

## 注意

- `policies/*.json` 的自动确认只针对演示使用方 `p-power-analyst` 和演示产品；生产请按产品/用途收窄或改回人工确认。
- `env/*.env`、`keys/`、`runtime/` 均不入库。
- 窃电检测的合成异常在阈值 0.5 时能稳定命中；默认 0.8 可能为空，这是数据强度而非执行失败。
