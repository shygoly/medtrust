# 医疗可信空间后端技术调研报告

> 调研时间：2026年2月8日
> 后端框架：NestJS（已确定）
> 调研范围：隐私计算、数据安全、区块链、医疗数据标准

---

## 一、技术选型总览

| 技术领域 | 首选方案 | 备选方案 | 集成难度 |
|---------|---------|---------|---------|
| **联邦学习** | FATE | PySyft | 中等 |
| **多方安全计算** | MP-SPDZ | CrypTen | 较高 |
| **可信执行环境** | Intel SGX/阿里云Enclave | AMD SEV | 中等 |
| **数据加密** | 国密SM2/SM3/SM4 | AES-256-GCM | 低 |
| **区块链** | FISCO BCOS | Hyperledger Fabric | 中等 |
| **医疗标准** | FHIR R4 | HL7 v2 | 低 |

---

## 二、联邦学习（FL）技术方案

### 2.1 开源框架对比

| 框架 | 开发方 | 特点 | 与NestJS集成 | 推荐度 |
|------|--------|------|-------------|--------|
| **FATE** | 微众银行/Linux基金会 | 工业级、完整生态 | Python微服务 | ⭐⭐⭐⭐⭐ |
| **PySyft** | OpenMined | 远程数据科学、HTTP友好 | 直接API调用 | ⭐⭐⭐⭐ |
| **TFF** | Google | 研究导向 | Python服务 | ⭐⭐⭐ |

### 2.2 推荐：FATE集成架构

```
┌─────────────────────────────────────────────────────────┐
│                    NestJS API Gateway                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ 任务管理API │  │ 模型管理API │  │ 数据协调API │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP/gRPC
┌──────────────────────────▼──────────────────────────────┐
│              FATE Flow Service (Python)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Job调度器  │  │ 模型聚合器  │  │  算法库     │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ 医院A   │  │ 医院B   │  │ 医院C   │
        │ FATE节点│  │ FATE节点│  │ FATE节点│
        └─────────┘  └─────────┘  └─────────┘
```

### 2.3 NestJS集成代码示例

```typescript
// fate.service.ts
@Injectable()
export class FATEService {
  private readonly client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: process.env.FATE_FLOW_URL,
      timeout: 60000,
    });
  }
  
  // 提交横向联邦学习任务
  async submitHorizontalFL(params: {
    hospitals: string[];
    algorithm: 'hetero_lr' | 'homo_nn' | 'secureboost';
    featureColumns: string[];
    labelColumn: string;
  }): Promise<FLJobResult> {
    const dsl = this.buildDSL(params);
    const conf = this.buildRuntimeConf(params);
    
    const { data } = await this.client.post('/v1/job/submit', { dsl, conf });
    return { jobId: data.job_id, status: data.code };
  }
  
  // 查询训练状态
  async queryJobStatus(jobId: string): Promise<JobStatus> {
    const { data } = await this.client.post('/v1/job/query', { job_id: jobId });
    return {
      jobId: data.job_id,
      status: data.f_status,
      progress: data.f_progress,
    };
  }
  
  // 获取联邦模型
  async getFederatedModel(modelId: string): Promise<ModelInfo> {
    const { data } = await this.client.post('/v1/model/query', {
      model_id: modelId,
    });
    return data.data;
  }
}
```

---

## 三、多方安全计算（MPC）技术方案

### 3.1 技术选型对比

| 库名 | 协议支持 | 性能 | 与NestJS集成 | 推荐度 |
|------|---------|------|-------------|--------|
| **MP-SPDZ** | SPDZ/MASCOT/Shamir | 高 | C++ FFI | ⭐⭐⭐⭐ |
| **CrypTen** | 基于PyTorch | 中 | Python服务 | ⭐⭐⭐⭐ |
| **Rosetta** | SecureNN/Helix | 中 | Python服务 | ⭐⭐⭐ |

### 3.2 推荐：MP-SPDZ集成方案

**适用场景**：跨医院敏感数据统计（患者数量、药物疗效均值等）

```typescript
// mpc.service.ts
@Injectable()
export class MPCService {
  private readonly mpcGateway: string;
  
  constructor(config: ConfigService) {
    this.mpcGateway = config.get('MPC_GATEWAY_URL');
  }
  
  // 安全求和：多家医院患者数量统计
  async secureSum(hospitalEndpoints: string[]): Promise<number> {
    const sessionId = await this.initMP Session(hospitalEndpoints, 'shamir');
    
    // 协调各方输入
    await Promise.all(
      hospitalEndpoints.map(endpoint =>
        this.sendInput(endpoint, sessionId, 'patient_count'),
      ),
    );
    
    // 获取计算结果
    return this.getMPCResult(sessionId);
  }
  
  // 安全均值计算
  async secureMean(
    hospitalEndpoints: string[],
    indicator: string, // 如：blood_pressure_systolic
  ): Promise<{ mean: number; std: number }> {
    const program = `
      # MP-SPDZ程序
      sfix total = 0;
      sint count = 0;
      
      for i in range(len(inputs)):
        total += inputs[i];
        count += 1;
      
      mean = total / count;
      return mean;
    `;
    
    return this.executeMPCProgram(hospitalEndpoints, program);
  }
}
```

---

## 四、可信执行环境（TEE）技术方案

### 4.1 技术对比

| 技术 | 厂商 | 硬件要求 | 安全等级 | 云服务支持 |
|------|------|---------|---------|-----------|
| **Intel SGX** | Intel | Xeon E/Scalable | 高 | 阿里云、AWS |
| **Intel TDX** | Intel | 4th Gen Xeon | 高 | Azure |
| **AMD SEV** | AMD | EPYC 7002+ | 高 | Azure、GCP |
| **阿里云Enclave** | 阿里云 | 机密计算实例 | 高 | ✅ 托管服务 |

### 4.2 推荐：阿里云SGX机密计算

```typescript
// tee.service.ts
@Injectable()
export class TEEComputingService {
  private readonly enclaveClient: any;
  
  constructor() {
    // 阿里云Enclave客户端
    this.enclaveClient = new AliyunEnclave({
      region: 'cn-hangzhou',
      accessKeyId: process.env.ALI_ACCESS_KEY,
      accessKeySecret: process.env.ALI_SECRET_KEY,
    });
  }
  
  // 在TEE中执行敏感计算
  async executeInTEE(
    code: string,
    encryptedInput: Buffer,
  ): Promise<TEEResult> {
    // 1. 创建Enclave实例
    const enclave = await this.enclaveClient.createEnclave({
      imageId: process.env.TEE_IMAGE_ID,
      instanceType: 'ecs.g7t.xlarge',
    });
    
    // 2. 远程证明验证
    const attestation = await enclave.getAttestation();
    await this.verifyAttestation(attestation);
    
    // 3. 建立安全通道并执行
    const result = await enclave.invoke({
      function: code,
      input: encryptedInput,
    });
    
    return result;
  }
  
  // 基因数据分析（TEE内执行）
  async analyzeGenomics(
    encryptedGenomeData: Buffer,
    analysisType: string,
  ): Promise<GenomicsResult> {
    const code = `
      // 在SGX Enclave内执行
      const genome = decrypt(encryptedGenomeData, dek);
      const result = performGenomicAnalysis(genome, analysisType);
      return encrypt(result, dek);
    `;
    
    return this.executeInTEE(code, encryptedGenomeData);
  }
}
```

---

## 五、数据安全与加密技术

### 5.1 国密算法Node.js实现

```typescript
// gm-crypto.service.ts
@Injectable()
export class GMCryptoService {
  private sm2 = require('sm-crypto').sm2;
  private sm3 = require('sm-crypto').sm3;
  private sm4 = require('sm-crypto').sm4;
  
  // SM2密钥对生成（非对称加密）
  generateSM2KeyPair(): { publicKey: string; privateKey: string } {
    return this.sm2.generateKeyPairHex();
  }
  
  // SM2加密（用于密钥交换）
  sm2Encrypt(data: string, publicKey: string): string {
    return this.sm2.doEncrypt(data, publicKey, 1); // C1C3C2模式
  }
  
  // SM2解密
  sm2Decrypt(encrypted: string, privateKey: string): string {
    return this.sm2.doDecrypt(encrypted, privateKey, 1);
  }
  
  // SM2签名
  sm2Sign(data: string, privateKey: string): string {
    return this.sm2.doSignature(data, privateKey);
  }
  
  // SM2验签
  sm2Verify(data: string, signature: string, publicKey: string): boolean {
    return this.sm2.doVerifySignature(data, signature, publicKey);
  }
  
  // SM3哈希（数据完整性）
  sm3Hash(data: string): string {
    return this.sm3(data);
  }
  
  // SM4加密（对称加密，用于数据存储）
  sm4Encrypt(data: string, key: string, iv?: string): string {
    if (iv) {
      return this.sm4.encrypt(data, key, { mode: 'cbc', iv });
    }
    return this.sm4.encrypt(data, key);
  }
  
  // SM4解密
  sm4Decrypt(encrypted: string, key: string, iv?: string): string {
    if (iv) {
      return this.sm4.decrypt(encrypted, key, { mode: 'cbc', iv });
    }
    return this.sm4.decrypt(encrypted, key);
  }
  
  // 信封加密：用SM2加密SM4密钥，再用SM4加密数据
  envelopeEncrypt(data: string, publicKey: string): EnvelopeCipher {
    // 生成随机SM4密钥
    const sm4Key = crypto.randomBytes(16).toString('hex');
    
    // SM4加密数据
    const encryptedData = this.sm4Encrypt(data, sm4Key);
    
    // SM2加密SM4密钥
    const encryptedKey = this.sm2Encrypt(sm4Key, publicKey);
    
    return {
      encryptedData,
      encryptedKey,
      algorithm: 'SM2-with-SM4',
    };
  }
}
```

### 5.2 数据库加密方案

```typescript
// 列级加密装饰器
export function EncryptedColumn(keyId: string) {
  return function (target: any, propertyKey: string) {
    Column({
      type: 'varchar',
      transformer: {
        to: (value: string) => {
          if (!value) return value;
          const key = getKeyFromVault(keyId);
          return encryptWithSM4(value, key);
        },
        from: (value: string) => {
          if (!value) return value;
          const key = getKeyFromVault(keyId);
          return decryptWithSM4(value, key);
        },
      },
    })(target, propertyKey);
  };
}

// 实体示例
@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  name: string; // 明文存储（非敏感）
  
  @EncryptedColumn('patient-id-card-key')
  idCard: string; // SM4加密存储
  
  @EncryptedColumn('patient-medical-history-key')
  medicalHistory: string; // SM4加密存储
  
  @EncryptedColumn('patient-contact-key')
  phoneNumber: string; // SM4加密存储
}
```

### 5.3 密钥管理（HashiCorp Vault）

```typescript
// vault.service.ts
@Injectable()
export class VaultService implements OnModuleInit {
  private vault: any;
  
  async onModuleInit() {
    const Vault = require('node-vault');
    this.vault = Vault({
      apiVersion: 'v1',
      endpoint: process.env.VAULT_ADDR,
      token: process.env.VAULT_TOKEN,
    });
  }
  
  // 获取数据加密密钥
  async getDataKey(keyId: string): Promise<string> {
    const result = await this.vault.read(`secret/data/medical/${keyId}`);
    return result.data.data.key;
  }
  
  // 动态数据库凭证
  async getDatabaseCredentials(): Promise<{ username: string; password: string }> {
    const result = await this.vault.read('database/creds/medical-app');
    return {
      username: result.data.username,
      password: result.data.password,
    };
  }
  
  // 加密DEK（数据加密密钥）
  async encryptDEK(dek: string, keyName: string): Promise<string> {
    const result = await this.vault.transit.encrypt({
      name: keyName,
      plaintext: Buffer.from(dek).toString('base64'),
    });
    return result.data.ciphertext;
  }
}
```

---

## 六、区块链与存证技术

### 6.1 联盟链选型

| 框架 | 开发方 | 国密支持 | TPS | 推荐度 |
|------|--------|---------|-----|--------|
| **FISCO BCOS** | 微众银行 | ✅ 全链路 | 10万+ | ⭐⭐⭐⭐⭐ |
| **Hyperledger Fabric** | Linux基金会 | ✅ 可配置 | 3000-20000 | ⭐⭐⭐⭐ |

### 6.2 推荐：FISCO BCOS（国产首选）

```typescript
// fisco-bcos.service.ts
@Injectable()
export class FiscoBcosService {
  private sdk: any;
  
  async onModuleInit() {
    const { Web3jService } = require('fisco-bcos-browser-sdk');
    this.sdk = new Web3jService({
      nodePath: process.env.FISCO_NODE_PATH,
      chainId: parseInt(process.env.FISCO_CHAIN_ID),
      groupId: 1,
    });
  }
  
  // 医疗数据存证
  async attestMedicalData(data: MedicalData): Promise<AttestationResult> {
    // 计算SM3哈希
    const dataHash = sm3(JSON.stringify(data));
    
    const contract = await this.sdk.getContract(
      process.env.ATTESTATION_CONTRACT,
      AttestationABI,
    );
    
    const tx = await contract.storeAttestation(
      dataHash,
      data.dataType,      // 'EMR' | 'PRESCRIPTION' | 'CONSENT'
      data.owner,         // 患者DID
      Math.floor(Date.now() / 1000),
    );
    
    return {
      txHash: tx.transactionHash,
      blockNumber: tx.blockNumber,
      dataHash,
      timestamp: Date.now(),
    };
  }
  
  // 验证数据完整性
  async verifyAttestation(
    dataHash: string,
    txHash: string,
  ): Promise<VerificationResult> {
    const receipt = await this.sdk.getTransactionReceipt(txHash);
    if (!receipt) return { valid: false, reason: 'Transaction not found' };
    
    // 解析事件日志
    const events = receipt.logs.map(log => this.sdk.parseLog(log));
    const event = events.find(e => e.event === 'AttestationStored');
    
    return {
      valid: event?.args?.dataHash === dataHash,
      blockNumber: receipt.blockNumber,
      timestamp: event?.args?.timestamp,
    };
  }
  
  // 查询存证历史
  async getAttestationHistory(dataHash: string): Promise<AttestationRecord[]> {
    const contract = await this.sdk.getContract(
      process.env.ATTESTATION_CONTRACT,
      AttestationABI,
    );
    
    const events = await contract.getPastEvents('AttestationStored', {
      filter: { dataHash },
      fromBlock: 0,
      toBlock: 'latest',
    });
    
    return events.map(e => ({
      dataHash: e.args.dataHash,
      dataType: e.args.dataType,
      owner: e.args.owner,
      timestamp: e.args.timestamp * 1000,
      txHash: e.transactionHash,
    }));
  }
}
```

---

## 七、医疗数据标准集成

### 7.1 FHIR R4集成

```typescript
// fhir.service.ts
@Injectable()
export class FHIRService {
  private client: any;
  
  constructor() {
    this.client = new Client({
      baseUrl: process.env.FHIR_SERVER_URL,
    });
  }
  
  // 创建患者资源
  async createPatient(patientData: CreatePatientDto): Promise<Patient> {
    const fhirPatient = this.toFHIRPatient(patientData);
    
    const result = await this.client.create({
      resourceType: 'Patient',
      body: fhirPatient,
    });
    
    return this.fromFHIRPatient(result);
  }
  
  // 查询患者病历
  async getPatientRecords(patientId: string): Promise<MedicalRecord[]> {
    const bundle = await this.client.search({
      resourceType: 'Observation',
      searchParams: { subject: `Patient/${patientId}` },
    });
    
    return bundle.entry?.map(e => this.fromFHIRObservation(e.resource)) || [];
  }
  
  // 转换为FHIR格式
  private toFHIRPatient(data: CreatePatientDto): any {
    return {
      resourceType: 'Patient',
      identifier: [{ system: 'http://hospital.org/mrn', value: data.mrn }],
      name: [{ use: 'official', family: data.familyName, given: [data.givenName] }],
      gender: data.gender,
      birthDate: data.birthDate,
      telecom: [{ system: 'phone', value: data.phone, use: 'mobile' }],
    };
  }
}
```

---

## 八、NestJS整体架构建议

### 8.1 项目结构

```
medical-trusted-space/
├── apps/
│   ├── api/                    # NestJS主应用
│   │   ├── src/
│   │   │   ├── auth/          # 认证授权
│   │   │   ├── privacy/       # 隐私计算模块
│   │   │   │   ├── fate/      # 联邦学习
│   │   │   │   ├── mpc/       # 多方安全计算
│   │   │   │   └── tee/       # 可信执行环境
│   │   │   ├── security/      # 数据安全
│   │   │   │   ├── crypto/    # 国密算法
│   │   │   │   ├── vault/     # 密钥管理
│   │   │   │   └── masking/   # 数据脱敏
│   │   │   ├── blockchain/    # 区块链存证
│   │   │   ├── fhir/          # 医疗标准
│   │   │   └── shared/
│   │   └── package.json
│   └── worker/                # 隐私计算任务执行器
├── libs/
│   ├── crypto/                # 国密算法库
│   ├── fhir-utils/            # FHIR工具库
│   └── mpc-sdk/               # MPC客户端SDK
└── docker-compose.yml
```

### 8.2 推荐技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **框架** | NestJS 10 | Node.js企业级框架 |
| **数据库** | PostgreSQL + pgvector | 主数据库+向量扩展 |
| **缓存** | Redis | 会话、缓存、分布式锁 |
| **消息队列** | RabbitMQ | 异步任务、事件驱动 |
| **隐私计算** | FATE + MP-SPDZ | 联邦学习+MPC |
| **TEE** | 阿里云SGX | 机密计算服务 |
| **区块链** | FISCO BCOS | 国产联盟链 |
| **密钥管理** | HashiCorp Vault | 企业级密钥管理 |
| **容器** | Docker + K8s | 容器化部署 |

---

## 九、实施路线图

### Phase 1（Week 1-2）：基础安全架构
- [ ] 国密SM2/SM3/SM4集成
- [ ] 数据库列级加密
- [ ] Vault密钥管理
- [ ] 数据脱敏组件

### Phase 2（Week 3-4）：区块链存证
- [ ] FISCO BCOS节点部署
- [ ] 存证合约开发
- [ ] NestJS SDK集成
- [ ] 存证API开发

### Phase 3（Week 5-6）：联邦学习
- [ ] FATE环境部署
- [ ] Python微服务开发
- [ ] NestJS网关开发
- [ ] 横向/纵向联邦学习场景实现

### Phase 4（Week 7-8）：MPC与TEE
- [ ] MP-SPDZ集成
- [ ] 安全统计功能
- [ ] 阿里云SGX接入
- [ ] 基因分析等敏感计算场景

### Phase 5（Week 9-10）：医疗标准与优化
- [ ] FHIR R4集成
- [ ] 性能优化
- [ ] 安全审计
- [ ] 文档完善

---

## 十、成本估算

| 组件 | 月成本（生产环境） |
|------|------------------|
| NestJS应用服务器（2台） | ¥2000 |
| PostgreSQL（RDS） | ¥1500 |
| Redis | ¥500 |
| Vault企业版 | ¥3000 |
| 阿里云SGX实例 | ¥5000 |
| FISCO BCOS节点（3个） | ¥3000 |
| FATE计算节点 | ¥4000 |
| **总计** | **约¥19000/月** |

---

*报告完成时间：2026年2月8日*
