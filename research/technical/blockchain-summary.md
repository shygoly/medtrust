# 医疗数据要素 - 区块链与存证技术调研

> 调研范围：联盟链框架、医疗存证场景、智能合约
> 合规要求：国密支持、等保合规

---

## 一、联盟链框架对比

| 框架 | 开发方 | 国密支持 | TPS | 生态成熟度 | 推荐度 |
|------|--------|---------|-----|-----------|--------|
| **FISCO BCOS** | 微众银行/金链盟 | ✅ 全链路 | 10万+ | 高 | ⭐⭐⭐⭐⭐ |
| **Hyperledger Fabric** | Linux基金会 | ✅ 可配置 | 3000-20000 | 高 | ⭐⭐⭐⭐ |

---

## 二、推荐方案：FISCO BCOS

### 2.1 核心优势

- **全链路国产化**：国密算法、国产OS、国产芯片
- **高性能**：单链10万+ TPS，区块流水线
- **生态完善**：WeBASE管理平台、WeDPR隐私保护、WeCross跨链
- **落地案例**：
  - 珠三角征信链
  - 粤澳健康码跨境互认
  - 国家健康医疗大数据科创平台

### 2.2 部署架构

```
轻节点（Air）→ 开发测试
专业节点（Pro）→ 生产环境
大规模节点（Max）→ 大型联盟
```

---

## 三、医疗存证场景

### 3.1 适用场景

| 场景 | 存证内容 | 价值 |
|------|---------|------|
| **电子病历存证** | 病历哈希、时间戳、操作日志 | 防篡改、可追溯 |
| **处方流转** | 处方签名、流转记录 | 防重复用药、合规审计 |
| **药物溯源** | 药品批次、流通记录 | 防伪、召回 |
| **医保结算** | 诊疗过程、费用明细 | 防欺诈、DRG/DIP |
| **知情同意** | 患者签名、同意书版本 | 法律保障 |
| **临床试验** | 试验数据、质控记录 | 数据完整性 |

### 3.2 存证智能合约

```solidity
// 医疗数据存证合约
contract MedicalAttestation {
    struct Attestation {
        bytes32 dataHash;      // 数据SM3哈希
        string dataType;       // 数据类型：EMR/PRESCRIPTION/CONSENT
        address owner;         // 数据所有者DID
        uint256 timestamp;     // 存证时间
        address attestor;      // 存证机构
    }
    
    mapping(bytes32 => Attestation) public attestations;
    mapping(bytes32 => bytes32[]) public history; // 历史版本
    
    event AttestationStored(
        bytes32 indexed dataHash,
        string dataType,
        address indexed owner,
        uint256 timestamp
    );
    
    function storeAttestation(
        bytes32 _dataHash,
        string memory _dataType,
        address _owner
    ) public returns (bool) {
        require(attestations[_dataHash].timestamp == 0, "Already attested");
        
        attestations[_dataHash] = Attestation({
            dataHash: _dataHash,
            dataType: _dataType,
            owner: _owner,
            timestamp: block.timestamp,
            attestor: msg.sender
        });
        
        emit AttestationStored(_dataHash, _dataType, _owner, block.timestamp);
        return true;
    }
    
    function verifyAttestation(bytes32 _dataHash) public view returns (bool) {
        return attestations[_dataHash].timestamp > 0;
    }
}
```

---

## 四、NestJS集成方案

### 4.1 服务封装

```typescript
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
      data.dataType,
      data.owner,
    );
    
    return {
      txHash: tx.transactionHash,
      blockNumber: tx.blockNumber,
      dataHash,
    };
  }
  
  // 验证存证
  async verifyAttestation(dataHash: string, txHash: string): Promise<boolean> {
    const receipt = await this.sdk.getTransactionReceipt(txHash);
    if (!receipt) return false;
    
    const events = receipt.logs.map(log => this.sdk.parseLog(log));
    const event = events.find(e => e.event === 'AttestationStored');
    
    return event?.args?.dataHash === dataHash;
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
    }));
  }
}
```

---

## 五、部署成本

| 组件 | 配置 | 月成本（3节点） |
|------|------|----------------|
| FISCO BCOS节点 | 4核8G | ¥3000 |
| WeBASE管理平台 | 2核4G | ¥800 |
| 存储（SSD） | 500GB | ¥500 |
| **总计** | - | **约¥4300** |

---

## 六、与Fabric对比

| 维度 | FISCO BCOS | Hyperledger Fabric |
|------|-----------|-------------------|
| 国密支持 | 原生全链路 | 需配置 |
| 性能 | 10万+ TPS | 3000-20000 TPS |
| 社区 | 国内为主 | 国际化 |
| 生态 | WeBASE等国产 | 国际生态 |
| 推荐场景 | 国内医疗 | 国际/跨国 |

---

*详细实现见完整技术报告*
