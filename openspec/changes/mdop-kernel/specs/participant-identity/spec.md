## ADDED Requirements

### Requirement: 参与方密钥自持
参与方（含各院连接器）的 SM2 密钥对 SHALL 由参与方在本地生成。注册时 MUST 只提交公钥，由中心 CA 为其签发证书。平台 MUST NOT 生成、保存或返回任何参与方私钥。

#### Scenario: 注册未提交公钥
- **WHEN** 一个连接器注册请求没有携带公钥
- **THEN** 平台 MUST 拒绝注册，MUST NOT 代为生成密钥对

#### Scenario: 平台接口不返回私钥
- **WHEN** 调用任何参与方注册或证书相关接口
- **THEN** 响应中 MUST NOT 出现任何私钥

### Requirement: 平台密钥按用途分离
平台 SHALL 持有三把用途互斥的 SM2 密钥：
- CA 根钥：只签发与吊销证书；
- 平台节点密钥：签 MDOP 信封、执行凭证、吊销名单，并以合约一方的身份副署合约；
- 注册中心密钥：签算子清单。

三把私钥 MUST 以 SM4 加密后落库，密钥加密密钥由部署配置或 Vault 提供。生产环境缺少密钥加密密钥时，平台 MUST 拒绝启动。连接器 MUST 在部署配置中固定三把公钥，并按用途验签：用错密钥签出的对象 MUST 被拒绝。

#### Scenario: 用 CA 根钥签的信封
- **WHEN** 连接器收到一条用 CA 根钥（而不是平台节点密钥）签名的 MDOP 信封
- **THEN** 连接器 MUST 以 `E_AUTH_INVALID` 拒收

#### Scenario: 私钥不以明文落库
- **WHEN** 读取控制面库中保存平台私钥的列
- **THEN** 读到的 MUST 是密文，不是可直接使用的私钥

#### Scenario: 生产环境缺少密钥加密密钥
- **WHEN** 生产环境启动时没有配置密钥加密密钥
- **THEN** 平台 MUST 拒绝启动
