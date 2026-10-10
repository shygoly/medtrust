# PACK.md — 能力包契约模板

> 一个能力包 = 一个领域在基座六根 SPI 上的实现 + 术语 + 合规章 + 页面。
> 模板类型见 `packages/space-kernel-spi` 的 `PackManifest`；示例见 `industries/med`。
> 三轴与闭源公理见 [KERNEL.md](KERNEL.md)；决策见 [DECISIONS.md](DECISIONS.md) D-SPD-*。

## 1. 包声明（PackManifest）

| 字段 | 含义 | 必填 |
|---|---|---|
| `id` | 包标识 | ✔ |
| `version` | 语义化版本 | ✔ |
| `domain` | 领域标签（如 healthcare / energy） | ✔ |
| `license` | 许可标识；开源拆分前 MUST 定（D-SPD-19） | ✔ |
| `compatibleSpi` | 兼容的 SPI 版本范围 | ✔ |
| `assuranceProfileId` | 默认合规 profile | 可选 |
| `provides` | 提供的缝实现清单 | ✔ |

## 2. 装配（D-SPD-10）

- **部署白名单**：启动读取本部署被授权运行的包集合；白名单 MUST NOT 决定单个空间的启用集。
- **空间运行期启用集**：空间在运行期声明启用哪些包；包注册表运行期可变。
- **连接器**：多空间 × 多包并存；密钥与证书按空间分栈。
- 启用未在白名单内的包 → **拒绝**。

## 3. 包必须回答的七件事

1. **术语**：编码系统 + 版本 + 许可（许可制词典 MUST 标来源）。
2. **数据源适配**：声明解析、校验 fail-closed、列裁剪与行过滤下推、最小投影载荷。
3. **算子**：kind（wasm / oci / system）+ 摘要来源；wasm 摘要 MUST 来自复现构建。
4. **出域模板**：最小计数 / 粗化 / K-匿名 / DP 等参数（**必开源或可审**）。
5. **计量口径**：贡献度来源；MUST 由编排器或量测算出，**不得由主体自报**。
6. **合规册**：行业专属合规契约（如电力另写 POWER-ASSURANCE），不得照抄他行业。
7. **页面**：导航契约 `nav.manifest.json` 的增量（受 `check-nav` 守护）。

## 4. 验收判据

- **基座代码零改动即可装载**——这是「基座是否真可复用」的唯一硬判据。
- 双能力包装配测试通过（纯度守门员）。
- 包 MUST NOT 扩张机制层（`system` 算子类别扩张须显式立决策，D-SPD-9）。
- 闭源环节 MUST 满足 §KERNEL.4 的准入公理。
