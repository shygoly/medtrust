# 医疗数据要素 - 数据安全技术调研

> 调研范围：国密算法、数据库加密、密钥管理、数据脱敏
> 合规要求：等保2.0/3.0、医疗数据安全管理办法

---

## 一、国密算法（SM2/SM3/SM4）

### 1.1 算法用途

| 算法 | 用途 | Node.js库 | 合规要求 |
|------|------|-----------|----------|
| **SM2** | 非对称加密、数字签名 | `sm-crypto` | 金融行业必备 |
| **SM3** | 哈希函数 | `sm-crypto` | 数据完整性验证 |
| **SM4** | 对称加密 | `sm-crypto` | 数据传输/存储加密 |

### 1.2 NestJS集成示例

```typescript
@Injectable()
export class GMCryptoService {
  private sm2 = require('sm-crypto').sm2;
  private sm3 = require('sm-crypto').sm3;
  private sm4 = require('sm-crypto').sm4;
  
  // SM2密钥对生成
  generateKeyPair(): { publicKey: string; privateKey: string } {
    return this.sm2.generateKeyPairHex();
  }
  
  // SM2加密（用于密钥交换）
  encrypt(data: string, publicKey: string): string {
    return this.sm2.doEncrypt(data, publicKey, 1);
  }
  
  // SM4加密（用于数据存储）
  encryptSM4(data: string, key: string): string {
    return this.sm4.encrypt(data, key);
  }
  
  // SM3哈希
  hash(data: string): string {
    return this.sm3(data);
  }
  
  // 信封加密：SM2加密SM4密钥，SM4加密数据
  envelopeEncrypt(data: string, publicKey: string): EnvelopeCipher {
    const sm4Key = crypto.randomBytes(16).toString('hex');
    const encryptedData = this.sm4Encrypt(data, sm4Key);
    const encryptedKey = this.sm2Encrypt(sm4Key, publicKey);
    return { encryptedData, encryptedKey, algorithm: 'SM2-with-SM4' };
  }
}
```

---

## 二、数据库加密

### 2.1 方案对比

| 方案 | 实现层级 | 特点 | 适用场景 |
|------|---------|------|---------|
| **PostgreSQL TDE** | 数据库层 | 透明加密，应用无感知 | 全盘加密 |
| **列级加密** | 应用层 | 灵活控制，字段级加密 | 敏感字段 |
| **pgcrypto扩展** | 数据库层 | SQL函数加密 | 存储过程 |

### 2.2 推荐：列级加密（TypeORM）

```typescript
// 加密列装饰器
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

// 实体定义
@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  name: string; // 明文
  
  @EncryptedColumn('patient-id-card-key')
  idCard: string; // 加密
  
  @EncryptedColumn('patient-medical-history-key')
  medicalHistory: string; // 加密
}
```

---

## 三、密钥管理

### 3.1 方案对比

| 方案 | 类型 | 特点 | 适用场景 |
|------|------|------|---------|
| **HSM** | 硬件 | 最高安全性、FIPS 140-2 | 核心密钥 |
| **云KMS** | 云服务 | 托管服务、高可用 | 通用密钥管理 |
| **HashiCorp Vault** | 软件 | 动态密钥、访问控制 | 企业级 |
| **K8s Secrets** | 容器原生 | 简单、与K8s集成 | 容器化部署 |

### 3.2 推荐：HashiCorp Vault + NestJS

```typescript
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
    return { username: result.data.username, password: result.data.password };
  }
}
```

---

## 四、数据脱敏

### 4.1 方案

| 工具 | 类型 | 功能 |
|------|------|------|
| **自研装饰器** | 代码层 | 灵活定制 |
| **MaskIt** | Node.js库 | 通用脱敏 |
| **ShardingSphere** | 中间件 | 数据库层脱敏 |

### 4.2 NestJS脱敏装饰器

```typescript
export function Masked(maskType: 'phone' | 'idCard' | 'name' | 'email') {
  return function (target: any, propertyKey: string) {
    Object.defineProperty(target, propertyKey, {
      get: function () {
        const value = this[`_${propertyKey}`];
        return maskValue(value, maskType);
      },
      set: function (value) { this[`_${propertyKey}`] = value; },
    });
  };
}

function maskValue(value: string, type: string): string {
  switch (type) {
    case 'phone': return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    case 'idCard': return value.replace(/(\d{6})\d{8}(\d{4})/, '$1********$2');
    case 'name': return value[0] + '*'.repeat(value.length - 1);
  }
}

// 使用
export class PatientDTO {
  @Masked('name') name: string;
  @Masked('phone') phoneNumber: string;
  @Masked('idCard') idCard: string;
}
```

---

## 五、合规要求清单

### 5.1 等保2.0/3.0要求

- [ ] 数据分类分级标识
- [ ] 传输加密（TLS 1.3 + SM2/SM4）
- [ ] 存储加密（SM4列级加密）
- [ ] 访问控制（RBAC + ABAC）
- [ ] 安全审计日志
- [ ] 数据脱敏展示
- [ ] 密钥安全管理

### 5.2 医疗数据安全管理办法

- [ ] 患者知情同意
- [ ] 数据最小化原则
- [ ] 第三方合作安全协议
- [ ] 数据跨境传输评估
- [ ] 数据安全事件应急响应

---

*详细实现见完整技术报告*
