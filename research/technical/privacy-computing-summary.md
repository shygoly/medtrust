# 医疗数据要素 - 隐私计算技术调研

> 调研范围：联邦学习(FL)、多方安全计算(MPC)、可信执行环境(TEE)
> 技术栈：NestJS + Python/C++

---

## 一、联邦学习（Federated Learning）

### 1.1 开源框架对比

| 框架 | 开发方 | 特点 | 与NestJS集成难度 | 推荐度 |
|------|--------|------|-----------------|--------|
| **FATE** | 微众银行/Linux基金会 | 工业级、完整生态、支持多种算法 | 中等（需Python服务） | ⭐⭐⭐⭐⭐ |
| **PySyft** | OpenMined | 远程数据科学、Datasite概念 | 较低（HTTP API友好） | ⭐⭐⭐⭐ |
| **TensorFlow Federated** | Google | 研究导向、PyTorch风格API | 中等 | ⭐⭐⭐⭐ |
| **FedML** | TensorOpera | 统一分布式训练、跨云平台 | 中等 | ⭐⭐⭐ |

### 1.2 推荐方案：FATE

**核心优势**：
- 全球首个工业级联邦学习开源框架
- 基于同态加密和多方安全计算的安全计算协议
- 支持横向、纵向、迁移联邦学习
- 完整生态：KubeFATE、FATE-Flow、FATE-Board、FATE-Serving
- 算法丰富：逻辑回归、树模型、深度学习、迁移学习

**医疗场景**：
- 跨医院疾病预测模型训练
- 药物副作用联合分析
- 多中心临床试验

**NestJS集成**：
```typescript
@Injectable()
export class FATEService {
  private readonly client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: process.env.FATE_FLOW_URL,
      timeout: 60000,
    });
  }
  
  async submitHorizontalFL(params: FLParams): Promise<FLJobResult> {
    const { data } = await this.client.post('/v1/job/submit', {
      dsl: this.buildDSL(params),
      conf: this.buildRuntimeConf(params),
    });
    return { jobId: data.job_id };
  }
}
```

---

## 二、多方安全计算（MPC）

### 2.1 开源库对比

| 库名 | 开发方 | 协议支持 | 与NestJS集成 | 推荐度 |
|------|--------|----------|-------------|--------|
| **MP-SPDZ** | CSIRO/Data61 | SPDZ/MASCOT/Shamir | 较难（C++） | ⭐⭐⭐⭐ |
| **CrypTen** | Meta/Facebook | 基于PyTorch | 中等 | ⭐⭐⭐⭐ |
| **Rosetta** | LatticeX | TensorFlow集成 | 中等 | ⭐⭐⭐ |

### 2.2 推荐方案：MP-SPDZ

**适用场景**：
- 跨医院患者数量安全统计
- 药物疗效均值计算
- 基因数据相关性分析

**技术特点**：
- 支持多种安全模型（诚实多数/恶意多数）
- 底层技术：秘密共享、同态加密、混淆电路
- 协议丰富：SPDZ、MASCOT、Shamir、Rep3

---

## 三、可信执行环境（TEE）

### 3.1 技术对比

| 技术 | 厂商 | 硬件要求 | 云服务商支持 | 推荐度 |
|------|------|---------|-------------|--------|
| **Intel SGX** | Intel | Xeon E/Scalable | 阿里云、AWS | ⭐⭐⭐⭐⭐ |
| **Intel TDX** | Intel | 4th Gen Xeon | Azure | ⭐⭐⭐⭐ |
| **AMD SEV** | AMD | EPYC 7002+ | Azure、GCP | ⭐⭐⭐⭐ |
| **阿里云Enclave** | 阿里云 | 机密计算实例 | ✅ 托管 | ⭐⭐⭐⭐⭐ |

### 3.2 推荐方案：阿里云SGX机密计算

**优势**：
- 托管服务，无需自建硬件
- 与阿里云KMS深度集成
- 支持国密算法
- 远程证明验证

**NestJS集成**：
```typescript
@Injectable()
export class TEEComputingService {
  private readonly enclaveClient: AliyunEnclave;
  
  async executeInTEE(code: string, encryptedInput: Buffer): Promise<TEEResult> {
    const enclave = await this.enclaveClient.createEnclave({
      imageId: process.env.TEE_IMAGE_ID,
      instanceType: 'ecs.g7t.xlarge',
    });
    
    const attestation = await enclave.getAttestation();
    await this.verifyAttestation(attestation);
    
    return enclave.invoke({ function: code, input: encryptedInput });
  }
}
```

---

## 四、技术选型总结

| 技术领域 | 首选方案 | 适用场景 | 集成复杂度 |
|---------|---------|---------|-----------|
| 联邦学习 | FATE | 跨院AI模型训练 | 中等 |
| MPC | MP-SPDZ | 敏感数据联合统计 | 高 |
| TEE | 阿里云SGX | 实时密文计算 | 中等 |

---

## 五、与NestJS集成架构

```
┌─────────────────────────────────────────────────────────┐
│                    NestJS API Gateway                    │
│              (认证、路由、API聚合、限流)                   │
└──────────────────────────┬──────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  FATE Service │  │  MPC Service  │  │  TEE Service  │
│  (Python API) │  │  (C++ FFI)    │  │  (云API)       │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

*详细实现代码见完整技术报告*
