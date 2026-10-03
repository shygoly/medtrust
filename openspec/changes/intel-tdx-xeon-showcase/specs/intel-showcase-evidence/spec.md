## ADDED Requirements

### Requirement: 画面可追溯到真实运行
演示截图与视频中出现的每个系统画面 MUST 来自三台机器上的真实运行，并在截图清单中绑定到一份机器可复核的证据（quote 摘要、验签判决、链上交易号、推理服务日志或接口响应）；MUST NOT 使用软件替身、模拟数据界面或后期合成的系统画面冒充真实运行。

#### Scenario: 截图清单逐条有证据
- **WHEN** 审阅截图清单
- **THEN** 每条截图都有对应证据文件路径、采集时间与机器标识

#### Scenario: 场景未跑通则不出片
- **WHEN** 某场景的端到端运行尚未完成
- **THEN** 该场景不进入视频，或明确标注为「进行中」，不以其他画面替代

### Requirement: 表述不越红线
对外物料的文字与旁白 MUST 符合 `tdx-attestation-pilot/external-claims.md` 的允许/禁止两栏，硬件与软件栈 MUST 按实测机型与实际部署如实书写，MUST NOT 出现性能主张或未使用的硬件。

#### Scenario: 出稿自查
- **WHEN** 视频文案与截图说明定稿
- **THEN** `node scripts/check-tee-claims.mjs` 全绿，且逐句对照表述清单无禁止项

#### Scenario: 推理栈如实
- **WHEN** 物料提到推理侧
- **THEN** 写的是实际部署的 OpenVINO Model Server、实际模型名与 Xeon 6 机型，不含 GPU 或速度数字

### Requirement: 全程合成数据
演示涉及的所有数据 MUST 为合成数据，物料中 MUST 明示。

#### Scenario: 画面标注
- **WHEN** 视频出现数据或结果画面
- **THEN** 画面或旁白明示「合成数据」
