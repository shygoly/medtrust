# 控制面 `TEE_ATTESTATION_REGISTRY` 装配样例（tasks 4.2，2026-10-14）

用途：把**云上 TDX 实测**得到的信任根与策略接到控制面。样例可直接照抄进 `AppModule`（或任一特性模块）的
`providers`；未注入时适配器抛错（fail-closed），行为不变。

```ts
// apps/api/src/app.module.ts（或 privacy/tee 模块）
import { TEE_ATTESTATION_REGISTRY } from "./privacy/tee/adapters/attestation-registry";
import type { ControlPlaneAttestationRegistry } from "./privacy/tee/adapters/attestation-registry";

const registry: ControlPlaneAttestationRegistry = {
  // 1) 信任根：云上 TDX 走 Intel 根（生产应由 KMS/配置注入，不入库）
  roots: { tdx: process.env.TDX_ROOT_CERTS ?? "" },
  // 2) 策略：只允许 tdx；按链给 min_tcb（不同链版本体系不可互比，协议按 fail-closed 处理）
  policy: {
    tee: ["tdx"],
    min_tcb: { tdx: "5.1.3" },
    // 3) 度量白名单 = 本仓**实测** MRTD（见 evidence/rerun-20261014/）
    allowed_measurements: [
      "sm3:14761963d7d7a1999ade127e7451951e8dd93fc094070537f26ad7990f9a2ce2",
    ],
  },
};

// providers: [{ provide: TEE_ATTESTATION_REGISTRY, useValue: registry }]
```

**取值出处**（都可复核）：

| 字段 | 取值 | 出处 |
|---|---|---|
| `policy.tee` | `["tdx"]` | 试点只打通 TDX；CSV 分支按 D-TEE-3 不变 |
| `policy.min_tcb.tdx` | `5.1.3` | 实测 TDX 证明的 TCB 版本（`evidence/rerun-20261014/`） |
| `policy.allowed_measurements[0]` | `sm3:14761963…a2ce2` | 实测 MRTD（同一证据档；两枚 `kind=tdx` 证明共用该度量） |

**注意**：这是**装配样例**，不是生产信任根分发方案；生产须按 D-TEE-1（密钥/根归属）与部署清单执行，
且 `TEE_ATTESTATION_REGISTRY` 未注入时适配器必须继续抛错（不得静默放行）。
