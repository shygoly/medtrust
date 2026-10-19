# WP0 注册研究助手测试指南

> 测试日期：2026-10-18  
> 测试环境：本地开发环境（localhost:5020）  
> 测试目标：验证 AGT-06（注册研究助手）A01-A10 完整流程

## 测试前准备

### 1. 确认服务运行

```bash
# API 服务（应返回 "healthy"）
curl http://localhost:5021/api/v1/health

# Web 服务（应能访问）
open http://localhost:5020
```

### 2. 准备测试账号

- 用户 ID: `test-user-registration`
- 空间 ID: `sh-med`（或其他已配置的空间）

### 3. 准备测试数据

确认控制面数据库中有：
- ✅ 至少 2 个参与方（试验方 + 对照方）
- ✅ 至少 2 个数据产品
- ✅ 至少 1 个可用合约（或能够创建合约）

---

## 测试步骤（A01-A10）

### A01 — 启动注册研究

**操作**：
1. 打开 http://localhost:5020
2. 登录/进入控制台
3. 打开助手对话页面
4. 输入：`"创建一项单臂外部对照注册研究"`

**预期输出**：
- ✅ 助手返回 Form Card
- ✅ Card 类型：`form`
- ✅ Card 标题：包含"注册研究"或"外部对照"
- ✅ 表单字段包含：studyId, product, indication

**截图**：
- 文件名：`a01-draft-form.png`
- 内容：完整的 Form Card 界面
- 备注：标注关键字段（studyId, product, indication）

---

### A02 — 提交研究基本信息

**操作**：
1. 填写表单：
   - studyId: `REG-ECA-TEST-001`
   - product: `SIM-MAB-01`（模拟单抗）
   - indication: `SIM-DERM-01`（模拟皮肤病）
2. 点击提交

**预期输出**：
- ✅ 助手返回 Confirm Card
- ✅ Card 显示研究草稿已创建
- ✅ 包含版本确认提示（P0/Protocol/SAP）

**截图**：
- 文件名：`a02-draft-confirm.png`
- 内容：Confirm Card 显示研究信息
- 备注：确认 studyId 和 status='draft'

---

### A03 — 验证 P0/Protocol/SAP 版本

**操作**：
1. 在新消息中输入版本信息，或点击 Confirm Card 的下一步
2. 提供：
   - profileVersion: `registration-eca/1.0.0`
   - protocolVersion: `v1.0`
   - sapVersion: `v1.0`

**预期输出**：
- ✅ 助手返回 Status Card
- ✅ tone: `success`
- ✅ 消息：版本校验通过

**截图**：
- 文件名：`a03-profile-status.png`
- 内容：Status Card 显示验证通过
- 备注：确认版本号显示正确

---

### A04 — 选择数据源与合约

**操作**：
1. 助手应自动提示选择数据源
2. 填写表单：
   - trial（试验方）：选择一个参与方
   - trialDataProduct：选择对应数据产品
   - primaryControl（主对照方）：选择另一个参与方
   - primaryControlDataProduct：选择对应数据产品
   - secondaryControl（可选）：留空或选择第三个参与方

**预期输出**：
- ✅ 助手返回 Form Card
- ✅ 显示参与方和数据产品下拉列表
- ✅ 选项来自控制面目录

**截图**：
- 文件名：`a04-sources-form.png`
- 内容：数据源选择表单
- 备注：标注参与方选择器和数据产品选择器

---

### A05 — 提交数据源信息

**操作**：
1. 提交 A04 的表单
2. 助手应显示研究计划确认

**预期输出**：
- ✅ 助手返回 Confirm Card
- ✅ 显示已解析的数据源列表
- ✅ 每个数据源包含 role, participantId, dataProductId

**截图**：
- 文件名：`a05-plan-confirm.png`
- 内容：研究计划确认卡
- 备注：确认数据源数量和角色正确

---

### A06 — 配置研究计划与合成数据

**操作**：
1. 确认研究计划后，助手提示配置研究参数
2. 填写：
   - timeZero: `first_prescription`
   - outcome: `adverse_event_serious`
   - covariates: `age,gender,baseline_condition`
   - missingness: `MAR`
   - effectMeasure: `risk-ratio`
   - truthRr: `0.65`（合成数据答案键）

**预期输出**：
- ✅ 助手返回 Form Card 或 Confirm Card
- ✅ 显示研究计划参数
- ✅ 合成数据配置（truthRr）

**截图**：
- 文件名：`a06-synthetic-form.png`
- 内容：研究计划与合成数据配置表单
- 备注：标注 truthRr 字段（仅合成研究需要）

---

### A07 — 提交作业

**操作**：
1. 确认所有配置后，提交注册研究作业
2. 助手应调用 `submit_external_control_registration` 工具

**预期输出**：
- ✅ 助手返回 Status Card
- ✅ tone: `info` 或 `success`
- ✅ 显示 jobId（如 `job-xxx-xxx`）
- ✅ 消息：作业已提交或正在处理

**截图**：
- 文件名：`a07-submit-status.png`
- 内容：作业提交状态卡
- 备注：记录 jobId 用于后续步骤

---

### A08 — 查询作业状态

**操作**：
1. 等待几秒（让作业处理）
2. 输入：`"查询作业 {jobId} 状态"`（替换为实际 jobId）

**预期输出**：
- ✅ 助手返回 Status Card
- ✅ 显示作业状态：`pending` / `running` / `succeeded` / `failed`
- ✅ 如果已完成，显示 stages 和 result

**截图**：
- 文件名：`a08-job-status.png`
- 内容：作业状态卡
- 备注：标注作业状态和阶段信息

---

### A09 — 生成报告

**操作**：
1. 确认作业状态为 `succeeded` 后
2. 输入：`"生成报告"`或`"生成 {studyId} 的注册研究报告"`

**预期输出**：
- ✅ 助手返回 Result Card
- ✅ 显示报告元数据：
  - reportId
  - studyId
  - jobId
  - 可用格式：json, html, docx

**截图**：
- 文件名：`a09-report-result.png`
- 内容：报告生成结果卡
- 备注：记录 reportId

---

### A10 — 下载报告

**操作**：
1. 输入：`"下载 JSON 格式报告"`
2. 或点击 Result Card 中的下载链接

**预期输出**：
- ✅ 助手返回 Result Card
- ✅ 显示下载链接：`/api/v1/mdop/reports/{reportId}.json`
- ✅ 其他格式链接：html, docx, evidence-zip

**截图**：
- 文件名：`a10-download-result.png`
- 内容：下载链接卡
- 备注：标注各格式的下载链接

---

## 验证清单

完成 A01-A10 后，验证以下内容：

### 1. 工具调用边界（AGENT.md R3）

检查浏览器开发者工具 → Network 标签，确认：
- ✅ 所有工具调用只请求 `/api/v1/chat` 或 `/api/v1/mdop/*`
- ✅ 没有直接请求连接器地址（:5022）
- ✅ 没有行级数据在请求/响应中传输

### 2. LLM 出域边界（FLOW-AI-06）

检查服务器日志（如果启用了 LLM）：
- ✅ 只发送 prompt-text 到外部供应商
- ✅ 不包含 participantId, dataProductId, contractId 等敏感标识
- ✅ 不包含行级数据或聚合结果

### 3. 凭据边界（D-TRUST-13）

下载生成的报告 JSON，检查：
- ✅ `metadata.syntheticOnly === true`
- ✅ `assistantSession.credentialPolicy === "fictional-fixture-only"`
- ✅ 截图中的凭据（如果有）标记为虚构

### 4. 报告结构完整性

打开下载的 `{reportId}.json`，确认包含：
- ✅ `schema` 和 `metadata`
- ✅ `study` 和 `protocol`
- ✅ `targetTrial` 和 `estimand`
- ✅ `sources`, `cohort`, `methods`
- ✅ `result`, `diagnostics`, `sensitivity`
- ✅ `truthRecovery`（合成研究特有）
- ✅ `execution` 和 `evidence`
- ✅ `assistantSession`（包含 messages, toolCalls, screenshots）

---

## 已知问题与解决方案

### 问题 1：e2e 测试失败（status.tone = 'error'）

**现象**：`chat.e2e.spec.ts` 中 `external-control-registration` 测试返回 error

**可能原因**：
1. 测试 mock API 返回数据格式不匹配
2. 场景提交需要额外字段（如 contractBundle）
3. 合规前置闸（evaluatePrerequisites）阻止提交

**临时解决**：
- 先完成真实环境测试（A01-A10）
- 根据实际行为更新 e2e 测试用例
- 或暂时跳过该测试（`it.skip`）

### 问题 2：没有可用合约

**现象**：A07 提交时返回合约缺失错误

**解决方案**：
1. 使用助手的合约创建功能（如果已实现）
2. 或手动创建合约：
   ```bash
   curl -X POST http://localhost:5021/api/v1/contracts \
     -H "Content-Type: application/json" \
     -d '{"participantId": "...", "dataProductId": "...", "purpose": "rws.external-control-registration"}'
   ```

### 问题 3：作业一直 pending

**现象**：A08 查询作业状态时一直显示 `pending`

**解决方案**：
1. 检查连接器是否运行（`lsof -i :5022`）
2. 检查作业调度器日志
3. 或使用 mock 作业快速完成测试

---

## 测试完成标准

✅ **所有 10 个步骤截图已保存**  
✅ **验证清单 4 项全部通过**  
✅ **下载的报告 JSON 结构完整**  
✅ **没有治理契约违规（R1-R4）**  

完成后，将截图和报告文件提交到：
- 截图：`docs/superpowers/plans/screenshots/wp0-registration-assistant/a*.png`
- 报告：`docs/superpowers/plans/screenshots/wp0-registration-assistant/registration-report-test-001.json`
