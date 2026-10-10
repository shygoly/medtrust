# 三方一致性套件（conformance kit）

包作者**无需内核私有件**即可自检能力包声明是否合规（D-SPD-19 / P11.3）。

```bash
node scripts/conformance/check-pack.mjs path/to/pack-manifest.json
```

判据见 [PACK.md](../../PACK.md)：

1. 必填字段齐全：`id` / `version` / `domain` / `license` / `compatibleSpi` / `provides`
2. `provides` 只引用六根 SPI（`dataSource` / `operators` / `egress` / `metering` / `assurance` / `terminology`）
3. 包 MUST NOT 扩张**机制层**（`systemOperators` / `sandbox` / `egressEngine` / `kernelPatch` / `spaceContext`）——须显式立内核决策（D-SPD-9）

退出码：0 = 合规；1 = 有错误；2 = 用法错误。
