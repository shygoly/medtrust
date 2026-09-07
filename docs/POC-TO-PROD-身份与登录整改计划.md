# MedTrust 身份与登录 — POC → 正式运营 整改计划

> 依据：图片中的登录流程要求（丝路数港/数智云风格登录弹窗 + 机构认证三步流程）
> 目标：让不同身份的使用者都能在正式运营环境中完成注册、登录、认证、入网、使用与治理。
> 摸底时间：2026-08-18，对 `apps/web` / `apps/api` / `apps/connector` / `packages/database` 当前代码逐项核查。
> 状态：**整改计划（待评审执行）**。动工前按 ARCHITECTURE §7.1 为每个任务建立 openspec change set。

---

## 0. 结论摘要（TL;DR）

1. **当前登录是 POC 形态**：仅邮箱+密码单一路径；登录页还带"快速选择演示账号"按钮；后端启动时自动播种 7 个硬编码演示账号。
2. **图片要求的三个登录方式（账号密码 / 手机快捷 / CA 证书）只实现了 0.33 个**：账号密码登录没有图形验证码；手机快捷登录、CA 证书登录完全缺失。
3. **机构认证全流程缺失**：图片中的"填写基本信息 → 完善认证信息 → 完成机构入驻"三步流程、营业执照上传、统一社会信用代码、CA 身份凭证生成（信通院接入连接器客户端、私钥仅存本机）在代码中零实现。
4. **角色模型不完整且口径不一致**：`User.participantRole` 含 `compliance`，但 `control-plane/index.ts` 导出的 `ParticipantRole` 类型只有 `provider|consumer|operator`，后端 `@ParticipantRoles("compliance")` 无法通过类型检查，合规接口实际上未做角色门禁。
5. **存在正式运营必须关闭的 POC 后门与生产风险**：启动播种演示账号、`login()` 不检查 `deletedAt`、JWT 验签不查库（禁用用户 access token 到期前仍可用）、审计日志任意登录用户可读、图形验证码/短信/锁定/密码重置全无。
6. **整改节奏**：P0 先关闭后门、补齐账号生命周期与登录安全（上线前必修）；P1 落地图片要求的登录三方式与机构认证三步流程、用户中心、运营审核台；P2 做 CA 证书登录、门户化页面、丝路数港/政务身份互认与深度安全加固。

---

## 0.1 已落地整改（截至第 17 轮）

| 编号 | 整改项 | 改动文件 | 验证 |
|---|---|---|---|
| P0-1 | 演示账号播种按环境门控（生产默认关闭，`SEED_DEMO_USERS` 显式控制）；登录页演示账号快速填充默认隐藏（`NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS` 控制） | `apps/api/src/auth/auth.service.ts`、`apps/web/src/app/login/page.tsx`、`DEPLOY.md`、`.env.example` | `pnpm --filter @medtrust/api build` ✅；`pnpm --filter web build` ✅ |
| P0-2 | `User` 增加 `status`（active/disabled/pending）；`login()` / `refresh()` / `exchangeSsoTicket()` / 重置密码统一校验 `deletedAt` 与 `status`；`JwtStrategy` 验签后查库兜底（60s 缓存），禁用/注销用户已签发 token 在缓存窗口后失效 | `packages/database/src/entities/user.entity.ts`、`apps/api/src/auth/auth.service.ts`、`apps/api/src/auth/jwt.strategy.ts` | database/api build ✅；`auth.service.spec.ts` + `admin.service.spec.ts` 36 passed ✅ |
| P0-3 | 图形验证码：新增 `auth_captchas` 实体 + `CaptchaService`（答案只存 SHA-256、5min 过期、一次性占用）+ `GET /auth/captcha` + 登录接口生产强制校验（`AUTH_CAPTCHA_REQUIRED` 可切换，开发默认不强制保 E2E）+ 登录页验证码输入/点击刷新 | `packages/database/src/entities/auth-captcha.entity.ts`、`apps/api/src/auth/captcha.service.ts`、`auth.controller.ts`、`auth.module.ts`、`dto/login.dto.ts`、`apps/web/src/app/login/page.tsx`、`apps/web/src/api/client.ts`、`DOMAIN.md`、`DEPLOY.md`、`.env.example` | database/api/web build ✅；`captcha.service.spec.ts` 4 passed ✅ |
| P0-4 | 登录/注册/忘记密码/重置密码接口专项限流（`@Throttle`）；**登录防爆破锁定**：`User.failedLoginCount` + `lockedUntil`，同账号连续失败 5 次锁 15 分钟，登录成功或重置密码解锁 | `apps/api/src/auth/auth.controller.ts`、`auth.service.ts`、`packages/database/src/entities/user.entity.ts` | API build ✅；`auth.service.spec.ts` 锁定/解锁用例 ✅ |
| P0-5 | 注册密码策略：至少 8 位且含大写/小写/数字/特殊字符中三类（后端 `@Matches` + 前端提示）；抽出 `password-policy.ts` 单一来源 | `apps/api/src/auth/dto/register.dto.ts`、`password-policy.ts`、`apps/web/src/app/register/page.tsx` | API build ✅；web build ✅ |
| P0-6 | 忘记密码：新增 `verification_codes` 实体（答案只存哈希、10min 有效、一次性）+ `MailService` 抽象（dev 控制台输出，生产未配 `SMTP_URL` fail-closed）+ `POST /auth/forgot-password` / `POST /auth/reset-password` + `/login/forgot` 页面 + 登录页"忘记密码"入口；重置成功后旧 refresh token 全部作废并解锁 | `packages/database/src/entities/verification-code.entity.ts`、`apps/api/src/auth/mail.service.ts`、`auth.service.ts`、`auth.controller.ts`、`auth.module.ts`、`dto/forgot-password.dto.ts`、`dto/reset-password.dto.ts`、`apps/web/src/app/login/forgot/page.tsx`、`apps/web/src/app/login/page.tsx`、`DOMAIN.md`、`DEPLOY.md`、`.env.example` | database/api/web build ✅；`auth.service.spec.ts` 通过 ✅ |
| P0-7 | 会话加固：前端 `api/client.ts` 存储 refresh token、401 → 静默 refresh → 原请求重试一次（单飞防并发）、refresh 失败才踢出；`logout` 调用 `/auth/logout` 撤销 refresh token；注册页改跳 `/space`（经 AuthGate 引导） | `apps/web/src/api/client.ts`、`apps/web/src/lib/auth.ts`、`apps/web/src/app/login/page.tsx`、`apps/web/src/app/login/sso/page.tsx`、`apps/web/src/app/register/page.tsx`、`apps/web/src/types/index.ts` | web build ✅ |
| P0-8 | `ParticipantRole` 类型收口补上 `compliance`；审计列表/完整性/统计接口加 `@ParticipantRoles("compliance","operator")`；结算台账合规方可见全局（与 operator 同权） | `packages/database/src/control-plane/index.ts`、`apps/api/src/audit/audit.controller.ts`、`apps/api/src/runtime/settlement/settlement.service.ts` | database/api build ✅ |
| P0-9 | 自注册未分配角色兜底：`AuthGate` 拉取 profile,无 `role` 用户看到"账号待分配参与方角色"引导页(含退出),不再进入业务控制台 | `apps/web/src/components/console/auth-gate.tsx`、`apps/web/src/api/client.ts` | web build ✅ |
| P0-10 | Swagger 生产默认关闭（`SWAGGER_ENABLED=true` 显式开启）；CORS 生产强制 `FRONTEND_URL` | `apps/api/src/main.ts`、`DEPLOY.md`、`.env.example` | API build ✅ |
| P0-11 | 运营方最小用户管理 API：`GET /admin/users`（搜索/筛选）、`PATCH /admin/users/:id`（分配角色/启用禁用，禁用即吊销 refresh token）、`POST /admin/users/:id/reset-password`（重置并解锁）；全部 `@ParticipantRoles("operator")` 门禁 | `apps/api/src/admin/*`（新模块）、`apps/api/src/app.module.ts` | database/api build ✅；`admin.service.spec.ts` 4 passed ✅ |
| P1-1(部分) | 登录页重构：三 tab 横向切换（账号密码/手机快捷/CA证书）；账号密码 tab 含账号（不限于邮箱，占位符"请输入账号"）+ 图形验证码 + 密码可见性切换；底部"立即注册/忘记密码"；CA tab 先展示凭证登录说明与禁用占位（CA 登录属 P2） | `apps/web/src/app/login/page.tsx` 重写 | web build ✅ |
| P1-2 | 手机快捷登录：`User.phone`（可空唯一）+ `SmsService` 抽象（dev 控制台输出、生产未配 `SMS_GATEWAY_URL` fail-closed）+ `POST /auth/sms/send`（60s 重发限制）+ `POST /auth/login/sms`（验证码 5min、错误 5 次作废、未注册手机号自动建 pending 账号）+ `VerificationCode.attempts` 计数 | `packages/database/src/entities/user.entity.ts`、`verification-code.entity.ts`、`apps/api/src/auth/sms.service.ts`、`auth.service.ts`、`auth.controller.ts`、`auth.module.ts`、`dto/send-sms-code.dto.ts`、`dto/sms-login.dto.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/login/page.tsx` | database/api/web build ✅；`auth.service.spec.ts` 含短信用例（合计 40+ passed）✅ |
| P1-3/P1-4 | 机构认证数据模型与 API：新增 `OrgCertificationApplication` 实体（control-plane，字段对齐图片步骤 1 全部字段 + CA 凭证 + 审核信息）；用户侧 `GET/PUT /account/certification`（草稿/提交，approved 后不可改）；运营侧 `GET /admin/certifications` + `POST /admin/certifications/:id/review`（operator 门禁） | `packages/database/src/control-plane/index.ts`、`apps/api/src/runtime/organization/*`（新模块）、`apps/api/src/app.module.ts` | database/api build ✅；`organization.service.spec.ts` 7 passed ✅ |
| P1-5 | 机构认证三步 UI：`/account` → `/account/identity`（三步流程 + 左侧用户中心导航 + 顶部用户信息/退出）；步骤 1 表单逐项对齐图片（机构类型/营业执照上传/机构名称/USCC 18 位/营业期限/注册地/注册详细地址/经营范围 0-1000/机构简介 0-2000/行业类型/注册金额/注册日期/LOGO）；步骤 2 预览确认；步骤 3 提交完成页；含 CA 身份凭证说明区（身份名称+公钥可保存） | `apps/web/src/app/account/page.tsx`、`apps/web/src/app/account/identity/page.tsx`、`apps/web/src/components/console/space-nav.tsx` | web build ✅（新增 /account、/account/identity 路由） |
| P1-6(部分) | 证照/LOGO 上传：`POST /account/upload`（kind=license≤5M / logo≤2M，JPG/PNG 白名单，S3 兼容对象存储复用已登记 `BUCKET_NAME`/`AWS_*` env；未配置时开发落本地 `data/uploads`、生产 fail-closed）；前端 FileReader→dataURL 上传并回填 key | `apps/api/src/runtime/organization/upload.service.ts`、`organization.controller.ts`、`organization.module.ts`、`dto/upload.dto.ts`、`apps/web/src/app/account/identity/page.tsx` | API build ✅；web build ✅ |
| P1-7 | 用户 CA 身份凭证：`POST /account/certification/ca`（客户端本地生成 SM2 密钥对、仅上报公钥,中心 CaService 签发 365 天证书,平台不存私钥）+ `POST /account/certification/ca/revoke`（换机作废重发,吊销注册表）；前端认证页 CA 区域可填写身份名称/公钥、生成/作废凭证并展示指纹 | `apps/api/src/runtime/organization/organization.service.ts`、`organization.controller.ts`、`organization.module.ts`、`dto/issue-user-ca.dto.ts`、`apps/web/src/app/account/identity/page.tsx`、`apps/web/src/api/client.ts` | database/api build ✅；`organization.service.spec.ts` 10 passed（含 CA 签发/作废/前置校验）✅；web build ✅ |
| P1-9 | 运营审核台：SpaceNav 新增「运营 · OPERATOR」组（operator 专属）;`/space/admin/users` 用户管理页（搜索/筛选、分配参与方与角色、启用禁用、重置密码）;`/space/admin/certifications` 机构认证审核页（查看证照/CA 指纹/经营范围,通过/驳回+原因） | `apps/web/src/components/console/space-nav.tsx`、`apps/web/src/app/(console)/space/admin/users/page.tsx`、`apps/web/src/app/(console)/space/admin/certifications/page.tsx`、`apps/web/src/api/client.ts` | web build ✅（新增 /space/admin/users、/space/admin/certifications 路由） |
| P1-8 | 手机号找回密码：`POST /auth/sms/reset-code`（60s 重发限制、防枚举）+ `POST /auth/reset-password/sms`（验证码 5min、重置后旧 refresh token 全吊销并解锁）；忘记密码页改为邮箱/手机双 tab | `apps/api/src/auth/auth.service.ts`、`auth.controller.ts`、`sms.service.ts`、`dto/sms-reset-password.dto.ts`、`apps/web/src/app/login/forgot/page.tsx`、`apps/web/src/api/client.ts` | database/api build ✅；`auth.service.spec.ts` 52 passed（含短信找回用例）✅；web build ✅ |
| P1-10(部分) | 门户频道与品牌：落地页顶部导航改为图片样式七频道（数据资源/数据产品/机构大厅/数据服务中心/需求大厅/行业空间/能力中心）+ 门户频道卡片区；全站清除"原型演示/进入演示"字样；品牌徽标改为"医疗可信数据空间 · 正式运营";CTA 改为"登录控制台/前往总门户";SpaceNav "v0" → "PROD";页脚新增 MedTrust 运营中心信息块 | `apps/web/src/app/(landing)/page.tsx`、`apps/web/src/components/console/space-nav.tsx`、`apps/web/src/app/docs/page.tsx` | web build ✅；`grep -rn "原型演示\|进入演示\|v0" apps/web/src` → 无输出 ✅ |
| P1-10(续) | 公开门户只读 API：`GET /public/catalog`（active 数据产品元数据）+ `GET /public/institutions`（cp_participant 机构大厅，含主体/数据认证状态）——无 JWT 守卫,访客可浏览;落地页门户频道区实时显示已挂牌数据产品数与入驻机构数 | `apps/api/src/runtime/portal/*`（新模块）、`apps/api/src/app.module.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/(landing)/page.tsx` | database/api build ✅；web build ✅ |
| P1-11(部分) | 用户中心：`/account` 入口 + 左侧导航（账号与身份/我的收藏占位）+ 顶部用户信息与退出；SpaceNav 用户名校名改为个人中心链接 | `apps/web/src/app/account/*`、`apps/web/src/components/console/space-nav.tsx` | web build ✅ |
| P2-1 | CA 证书登录（挑战-签名）：`POST /auth/ca/challenge`（5min 一次性挑战,内存态）+ `POST /auth/login/ca`（客户端本地 SM2 私钥签名 → 平台用机构认证中的 CA 公钥验签 + 吊销检查 → 签发会话,私钥永不上传）;登录页 CA tab 可获取挑战/粘贴签名/签名登录 | `apps/api/src/auth/auth.service.ts`、`auth.controller.ts`、`auth.module.ts`、`dto/ca-challenge.dto.ts`、`dto/ca-login.dto.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/login/page.tsx` | database/api build ✅；`auth.service.spec.ts` 新增 5 个 CA 用例（合计 57 passed）✅；web build ✅ |
| P1-6(收尾) | 已上传证照/LOGO 鉴权读取与预览：`GET /account/files?key=`（JwtAuthGuard + 用户前缀鉴权；S3 兼容 GetObject / 本地 dev 文件读取）;认证页证照与 LOGO 上传后及回填后均以 blob objectURL 显示缩略图预览 | `apps/api/src/runtime/organization/upload.service.ts`、`organization.controller.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/account/identity/page.tsx` | database/api build ✅；web build ✅ |
| P2-5(部分) | 审计报告导出：`GET /audit/export`（compliance/operator 门禁;JSON 报告含生成时间/筛选条件/SM3 链完整性校验结论/全部命中条目与 entryHash/prevHash）;审计页新增「导出报告」按钮下载 JSON | `apps/api/src/audit/audit.service.ts`、`audit.controller.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/(console)/space/audit/page.tsx` | database/api build ✅；web build ✅ |
| P1-11 | 我的收藏：新增 `favorites` 实体（user+product 唯一索引,默认库）;`GET/POST/DELETE /account/favorites`（登录后访问,跨库补全产品标题/URN/状态）;`/account/favorites` 页面(列表/取消收藏);用户中心左侧导航接通「我的收藏」 | `packages/database/src/entities/favorite.entity.ts`、`entities/index.ts`、`apps/api/src/account/*`（新模块）、`apps/api/src/app.module.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/account/favorites/page.tsx`、`identity/page.tsx` | database/api build ✅；web build ✅（新增 /account/favorites） |
| P2-4(部分) | MFA/TOTP：新增 `TotpService`（RFC 6238,HMAC-SHA1,30s 窗口,6 位,无第三方依赖）;`POST /auth/mfa/setup`(生成密钥+otpauth URL) / `enable` / `disable`;登录时 `mfaEnabled` 账号强制校验 `mfaCode`;登录页增加可选 MFA 验证码输入;`/account/security` 安全设置页(绑定/启用/禁用) | `apps/api/src/auth/totp.service.ts`、`auth.service.ts`、`auth.controller.ts`、`auth.module.ts`、`dto/mfa-code.dto.ts`、`dto/login.dto.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/login/page.tsx`、`apps/web/src/app/account/security/page.tsx` | database/api build ✅；`auth.service.spec.ts` MFA 用例（合计 59 passed）✅；web build ✅（新增 /account/security） |
| P2-5(证据包) | 审计证据包(ZIP)：新增 `EvidencePackageService` + 最小 ZIP 打包器(store 模式,无第三方依赖);`GET /audit/evidence-package`（compliance/operator,附件下载,响应头带 X-Evidence-Fingerprint）;包内含 report.html(可打印 PDF)/report.json/attestations.json/contracts.json/manifest.json(每文件 SM3+SHA256 摘要 + 证据包指纹);审计页新增「导出证据包(ZIP)」按钮 | `apps/api/src/audit/evidence-package.service.ts`、`zip.util.ts`、`audit.controller.ts`、`audit.module.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/(console)/space/audit/page.tsx` | database/api build ✅；`zip.util.spec.ts` + `evidence-package.service.spec.ts`（72 passed）✅；web build ✅ |
| P2-6(部分) | admin 角色拆分：`ParticipantRole` 增加 `admin`(User/类型/UpdateUserDto/前端 roleLabel/AuthGate/SpaceNav 同步);新增 `GET /admin/system/status`（仅 admin,返回 Node/平台/运行时长/环境摘要,不含密钥）;SpaceNav 新增「管理 · ADMIN」组;`/space/admin/system` 系统状态页 | `packages/database/src/control-plane/index.ts`、`entities/user.entity.ts`、`apps/api/src/admin/system.controller.ts`、`admin.module.ts`、`dto/update-user.dto.ts`、`apps/web/src/lib/auth.ts`、`api/client.ts`、`space-nav.tsx`、`auth-gate.tsx`、`app/(console)/space/admin/system/page.tsx` | database/api build ✅；web build ✅（新增 /space/admin/system） |
| P2-2 | 丝路数港互认(MedTrust 侧)：新增 `cp_interop_subject` 实体(control-plane,主体缓存+participantId 映射);`SilkRoadClient` 抽象(生产未配 `SILKROAD_NODE_ENDPOINT` fail-closed,开发 mock 主体);`POST /admin/interop/silk-road/sync`(身份互认同步) / `push-catalog`(目录同步) / `report-audit`(日志上报),operator+admin 门禁;用户侧 `GET /account/interop/silk-road/subjects` + `POST /account/interop/silk-road/subjects/:id/import`(机构认证「从丝路数港带入」,免重复上传);认证页新增带入 UI;`/space/admin/interop` 运营互认页;DEPLOY.md/.env.example 登记 `SILKROAD_NODE_ENDPOINT`/`SILKROAD_NODE_ID` | `packages/database/src/control-plane/index.ts`、`apps/api/src/runtime/silk-road/*`（新模块）、`apps/api/src/app.module.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/account/identity/page.tsx`、`apps/web/src/app/(console)/space/admin/interop/page.tsx`、`space-nav.tsx`、`DEPLOY.md`、`.env.example` | database/api build ✅；`silk-road.service.spec.ts` 3 passed（合计 75 passed）✅；web build ✅（新增 /space/admin/interop） |
| P2-2(续) | 主体自动入册：同步时按 org 查找/创建 `cp_participant`（subjectVerified=true，区域节点已核验主体），回填 `cp_interop_subject.participantId` 并置 mapped;新增《丝路数港-接口对拍表》文档（身份互认/目录同步/日志上报 × MedTrust 实体/端点/状态 + 待接口文档补齐清单） | `apps/api/src/runtime/silk-road/silk-road.service.ts`、`silk-road.module.ts`、`docs/丝路数港-接口对拍表.md` | database/api build ✅；`silk-road.service.spec.ts` 自动映射断言 ✅ |
| P2-6(收尾) | 基础设施管理(admin)：新增 `cp_open_platform_app` 实体(密钥只存 SHA-256,创建时明文返回一次);`GET /admin/infra/spaces`(空间**只读**;创建/删除唯一入口保持 `/spaces` operator 门禁,INV-SPACE-01,避免双入口角色口径冲突);`GET /admin/infra/certificates` + `POST /admin/infra/certificates/:fingerprint/revoke` + `GET /admin/infra/ca/info`(证书生命周期,CA 信息不含私钥);`GET/POST /admin/infra/open-platform/apps` + `POST /admin/infra/open-platform/apps/:id/revoke`(开放平台应用管理);全部 `@ParticipantRoles("admin")` 门禁;`/space/admin/infra` 基础设施页(空间只读/CA/证书/应用);SpaceNav 接入 | `packages/database/src/control-plane/index.ts`、`apps/api/src/admin/infra-admin.*`、`dto/create-app.dto.ts`、`admin.module.ts`、`apps/web/src/api/client.ts`、`apps/web/src/app/(console)/space/admin/infra/page.tsx`、`space-nav.tsx` | database/api build ✅；`infra-admin.service.spec.ts`（含空间只读断言，合计 78 passed）✅；web build ✅ |
| — | 契约对拍 | — | `node scripts/check-meta-docs.mjs` → 0 error ✅ |

> 运行态端到端验证说明：本机 `better-sqlite3@9.6.0` 原生模块与当前 Node ABI 不匹配（NODE_MODULE_VERSION 115 vs 137），且 9.6.0 在 Node 24 上 `pnpm rebuild` 编译失败（node-gyp C++ 编译错误），API 进程无法直接拉起做 curl 级验证；已用数据库包/API/Web 三端构建 + Jest 测试 + 契约检查替代。部署/本机运行前需将 `better-sqlite3` 升级到支持 Node 24 的版本（或改用 Node 20/22 LTS）后重新安装。

---

## 1. 图片登录流程要求（逐项拆解）

### 1.1 登录弹窗（用户登录）

| # | 要求 | 当前实现 |
|---|---|---|
| L-1 | 三种登录方式横向切换：**账号密码登录 / 手机快捷登录 / CA证书登录** | 无 tab，仅邮箱+密码 |
| L-2 | 账号密码登录：账号 + **图形验证码** + 密码 | 仅 邮箱 + 密码 |
| L-3 | 账号输入框提示"请输入账号"（不限于邮箱） | 硬编码 `type=email`、占位符 `you@example.com` |
| L-4 | 图形验证码图片，动态刷新 | 无 |
| L-5 | 密码可见性切换（眼睛图标） | 无 |
| L-6 | 底部链接：**立即注册** / **忘记密码** | 仅"立即注册"，无"忘记密码" |
| L-7 | 弹窗式居中登录框 | 整页登录页（可接受，但需与门户导航融合） |
| L-8 | 登录失败/验证码错误有明确提示 | 仅有通用错误条 |

### 1.2 机构认证三步流程（用户中心 → 账号与身份）

| # | 要求 | 当前实现 |
|---|---|---|
| C-1 | 步骤 1 **填写基本信息**：机构类型、营业执照上传（JPG/PNG ≤5M）、机构名称、统一社会信用代码（18 位）、营业期限（长期/自定义）、注册地、注册详细地址、经营范围（≤1000 字） | 零实现 |
| C-2 | 步骤 1 附加信息：行业类型、注册金额（万元）、注册日期、机构 LOGO（≤2M） | 零实现 |
| C-3 | **CA 身份凭证**区域：未生成 → 展示生成三步说明（下载信通院接入连接器客户端 → 运行客户端并填写身份名称生成公钥 → 生成完成） | 零实现；CA 只签发给连接器，不签发给"人/机构用户" |
| C-4 | CA 凭证安全提示：私钥仅存本机、平台/节点服务端不存私钥、建议导出离线设备、换电脑可作废重发 | 无用户侧对应文案与流程 |
| C-5 | 步骤 2 **完善认证信息**、步骤 3 **完成机构入驻** | 零实现 |
| C-6 | 用户中心左侧导航：账号与身份、我的收藏 | 无用户中心 |
| C-7 | 顶部用户名 + 下拉菜单 | 仅 SpaceNav 底部显示用户，无菜单 |

### 1.3 门户外观（正式运营形象）

| # | 要求 | 当前实现 |
|---|---|---|
| P-1 | 顶部导航：数据资源、数据产品、机构大厅、数据服务中心、需求大厅、行业空间、能力中心 | 落地页为锚点导航（三闭环/数据不出域/密算编排/合规/文档），无门户业务频道 |
| P-2 | 登录入口 + "前往总门户" | 仅"登录 / 进入演示" |
| P-3 | 平台正式名称与运营中心信息（地址/电话/邮箱） | 落地页为 MedTrust 品牌 + "原型演示"徽标；SpaceNav 标注 "FEDERATED DATA SPACE · v0" |

---

## 2. 当前实现盘点（代码证据）

### 2.1 登录/注册链路

| 项 | 位置 | 现状 |
|---|---|---|
| 登录页 | `apps/web/src/app/login/page.tsx` | 邮箱+密码；内嵌 `DEMO_ACCOUNTS` 快速填充按钮（硬编码 `demo123456`） |
| 注册页 | `apps/web/src/app/register/page.tsx` | 邮箱+密码+姓名（可选）；注册即签发 token 跳转，无验证、无角色 |
| 免登页 | `apps/web/src/app/login/sso/page.tsx` | 西安节点 ticket 兑换（已实现，可保留） |
| 后端控制器 | `apps/api/src/auth/auth.controller.ts` | `POST /auth/register|login|refresh|logout|sso/exchange|profile` |
| 后端服务 | `apps/api/src/auth/auth.service.ts` | `bcrypt` 校验；`onModuleInit → initDemoUsers()` 播种 7 个演示账号 |
| DTO | `apps/api/src/auth/dto/login.dto.ts` | `LoginDto` 仅 `email/password`，`@MinLength(6)` |
| DTO | `apps/api/src/auth/dto/register.dto.ts` | `RegisterDto` 仅 `email/password/name?` |

### 2.2 会话与安全

| 项 | 位置 | 现状 |
|---|---|---|
| JWT | `apps/api/src/auth/jwt.strategy.ts` | 验签后直接返回 payload，**不查库**（禁用/删除用户 token 到期前仍有效） |
| JWT 密钥 | `apps/api/src/auth/jwt-secret.util.ts` | 生产环境未设置 `JWT_SECRET` 会拒绝启动（好）；开发环境随机密钥 |
| Refresh Token | `apps/api/src/auth/auth.service.ts` | 存 SHA-256 哈希、轮换吊销（已实现）；但前端 `api/client.ts` 不刷新，401 即踢出 |
| 登录防爆破 | `apps/api/src/app.module.ts` | 仅全局 Throttler（100/s + 20/s），无 `/auth/login` 专项限流、无失败锁定 |
| 验证码 | 全仓 | 无 |
| 短信 | 全仓 | 无 |
| 密码重置 | 全仓 | 无 |
| 账号禁用 | `User.deletedAt` 存在 | `login()` 不检查 `deletedAt`；`exchangeSsoTicket()` 检查 |
| 用户状态字段 | `User` | 无 `status/disabled` 字段 |
| MFA 字段 | `User.mfaSecret/mfaEnabled` | 有字段，无任何端到端流程 |
| Swagger | `apps/api/src/main.ts` | 生产环境无开关，`/api/docs` 裸露 |
| CORS | `apps/api/src/main.ts` | `FRONTEND_URL` 缺省 `http://localhost:5020`，生产未强制 |

### 2.3 角色与权限

| 项 | 位置 | 现状 |
|---|---|---|
| 用户角色 | `packages/database/src/entities/user.entity.ts` | `participantRole: 'provider'\|'consumer'\|'operator'\|'compliance'` |
| 类型定义 | `packages/database/src/control-plane/index.ts` | `export type ParticipantRole = 'provider'\|'consumer'\|'operator'`（**缺 compliance**） |
| 后端守卫 | `apps/api/src/auth/participant-roles.guard.ts` + `participant-role.decorator.ts` | 仅支持类型里的三角色；全仓 grep 无任何 `@ParticipantRoles("compliance")` |
| 前端门禁 | `apps/web/src/components/console/role-gate.tsx`、`space/compliance/page.tsx` | 前端有 compliance 视图，但后端对应审计/结算接口无合规角色门禁 |
| 审计接口 | `apps/api/src/audit/audit.controller.ts` | 仅 `JwtAuthGuard`，**任意登录用户**可读全部审计日志 |
| 结算接口 | `apps/api/src/runtime/settlement/settlement.controller.ts` | 仅 `JwtAuthGuard` |
| 未分配角色用户 | 自注册后 `participantId/participantRole` 为空 | `AuthGate` 放行，SpaceNav 隐藏受限组，用户进入空壳控制台，无引导 |
| JWT payload | `apps/api/src/auth/auth.service.ts` | `{ sub, email, participantId, role, tenantId }`；签发后角色变更需等 token 过期 |

### 2.4 机构认证与 CA 身份

| 项 | 位置 | 现状 |
|---|---|---|
| CA 服务 | `apps/api/src/runtime/participant-identity/ca.service.ts` | SM2 CA 签发/吊销**连接器**证书，持久化 `cp_certificate` |
| 连接器注册 | `apps/api/src/runtime/participant-identity/connector-admin.controller.ts` | `POST/DELETE /connectors`（operator 门禁） |
| 参与方注册表 | `apps/api/src/runtime/participant-identity/participant-registry.service.ts` + `cp_participant` | 主体/数据双认证字段（subjectVerified/dataVerified），但**无控制器、无 UI、无机构认证申请流** |
| 用户-机构字段 | `packages/database/src/entities/xian-user-link.entity.ts` | 仅存 `enterpriseName/unifiedSocialCreditCode` 两个公开字段，且只供西安节点同步写入 |
| 用户 CA 证书 | 无 | 无表、无 API、无 UI |
| 证照上传 | 无 | 无文件上传模块（S3 相关 env 存在，但未用于证照） |
| 信通院客户端 | 无 | 无下载页、无客户端对接、无公钥上报接口 |

### 2.5 自注册与演示账号（POC 残留）

| 项 | 现状 | 生产风险 |
|---|---|---|
| `AuthService.initDemoUsers()` | 启动即播种 7 个账号（`admin@huashan-hospital.com` 等，密码 `demo123456`） | 正式运营后这些高权限账号形同后门 |
| 登录页 `DEMO_ACCOUNTS` | 一键填充密码登录 | 任何人可用演示账号登入 |
| 落地页/导航 "原型演示"、"v0" | 文案未去 POC 化 | 对外形象不符 |
| `FEATURE_*` 开关 | `.env.example` 保留 feature flags | 可继续用于灰度，但需与正式功能区分 |

---

## 3. 不同身份使用者的差距矩阵

> 角色定义沿用 `DOMAIN.md`/`TRUST.md` 与代码：`provider`（数据提供方，医院）、`consumer`（数据使用方，药企/研究院）、`operator`（运营/监管方，卫健委）、`compliance`（合规方）。新增 `pending`（已注册未分配）与 `admin`（平台管理员，建议从 operator 拆出）。

| 身份 | 当前体验（POC） | 正式运营应达到 | 主要差距 | 优先级 |
|---|---|---|---|---|
| **未登录访客** | 落地页锚点介绍，只能"进入演示" | 浏览门户各频道（数据资源/数据产品/机构大厅/需求大厅/行业空间/能力中心）、查看公开目录、注册、登录 | 无公开门户频道；注册入口弱；无"前往总门户" | P1/P2 |
| **自注册待分配用户** | 注册即获 token，但 `role=undefined`，进入控制台后无菜单、无引导 | 注册 → 邮箱/手机验证 → 完善机构认证 → 提交审核 → 等待/被驳回提示 → 分配角色后可用 | 无验证、无机构认证、无待分配工作台、无角色 | P0/P1 |
| **数据提供方（provider）** | 演示账号可看目录/连接器，可发布数据产品（有后端门禁） | 完成机构认证（营业执照/USCC/CA 凭证）→ 运营审核通过 → 绑定本机构连接器 → 发布产品、签合约、结算 | 无机构认证与凭证；无"我的机构"；连接器凭证仍是 token 降级可关未强制 | P1/P2 |
| **数据使用方（consumer）** | 演示账号可提交任务、看交付 | 完成机构认证 → 审核通过 → 申请数据产品、签合约、收交付物、结算 | 同上；自注册无法成为使用方 | P1 |
| **运营/监管方（operator）** | 演示账号可注册连接器、看合规/审计 | 用户管理（启用/禁用/分配角色）、机构认证审核、连接器审核、平台运行监测、审计报告导出 | 无用户管理 API/UI；无机构审核台；审计导出无 | P0/P1 |
| **合规方（compliance）** | 前端有合规总览/告警/审计视图 | 后端接口同样按合规/运营角色门禁；审计报告导出、证据包、存证查验 | `ParticipantRole` 类型缺 compliance；审计/结算接口任意登录可读；无报告导出 | P0/P1 |
| **平台管理员（admin）** | 无此角色，operator 兼职 | 与 operator 拆开：系统配置、密钥/证书生命周期、租户/空间管理、开放平台应用管理 | 角色未拆分；无管理后台 | P2 |
| **西安节点同步用户（xian-*）** | `open-api/user/sync` 建号 + `open-api/login` 免登 ticket | 首次登录后仍需补充机构认证、CA 凭证；账号状态受控 | 与本地用户流未统一；`xian-` 前缀账户无机构认证引导 | P1/P2 |

---

## 4. 整改计划

### 4.1 P0 — 上线前必修（关闭后门 + 账号生命周期 + 登录安全）

> 验收口径：未完成 P0 前，不得向真实用户开放注册与登录。

| # | 任务 | 整改内容 | 涉及模块 | 验收标准 |
|---|---|---|---|---|
| P0-1 | 移除演示账号后门 | `initDemoUsers()` 改为仅在 `NODE_ENV!=='production' && SEED_DEMO_USERS==='true'` 时执行；登录页 `DEMO_ACCOUNTS` 快速填充按钮在生产构建隐藏（env 门控） | `apps/api/src/auth/auth.service.ts`、`apps/web/src/app/login/page.tsx` | 生产环境启动后 `users` 表无演示账号；登录页无快速填充 |
| P0-2 | 账号状态字段与禁用检查 | `User` 增加 `status: 'active'\|'disabled'\|'pending'`；`login()`/`refresh()`/`exchangeSsoTicket()` 统一检查 `deletedAt` 与 `status`；`JwtStrategy.validate()` 或 `JwtAuthGuard` 增加查库校验（缓存 60s） | `packages/database/src/entities/user.entity.ts`、`apps/api/src/auth/` | 禁用/删除用户登录被拒；已签发 token 在缓存窗口后立即失效 |
| P0-3 | 图形验证码 | 新增 `CaptchaService`（SVG 或位图，答案只存哈希+过期 5min+一次性）；`GET /auth/captcha` 返回 `{captchaId, image}`；`LoginDto` 增加 `captchaId/captchaCode`，账号密码登录必填 | `apps/api/src/auth/`、`apps/web/src/app/login/page.tsx` | 错误验证码登录被拒；验证码一次性、不可重放；刷新按钮可用 |
| P0-4 | 登录限流与锁定 | 对 `/auth/login`、`/auth/register` 加 `@Throttle`（如 5 次/分钟/IP）；新增失败计数与锁定（同账号连续失败 5 次锁 15 分钟，`lockedUntil`）；登录成功/失败写审计日志 | `apps/api/src/auth/`、`packages/database/src/entities/user.entity.ts` | 爆破脚本被节流；锁定账号登录返回明确错误；审计可查 |
| P0-5 | 密码策略 | `LoginDto/RegisterDto` 密码 `@MinLength(8)` + 复杂度（大小写/数字/特殊字符至少三类）；注册页同步校验 | `apps/api/src/auth/dto/`、`apps/web/src/app/register/page.tsx` | 弱密码注册被 400 拒绝；前端有强度提示 |
| P0-6 | 忘记密码/重置 | `POST /auth/forgot-password`（邮箱验证码）与 `POST /auth/reset-password`；验证码 10min 有效、一次性、限流 | `apps/api/src/auth/`、新增 `apps/web/src/app/login/forgot/page.tsx` | 用户可自助重置密码；旧密码立即失效（access token 短 TTL + 查库兜底） |
| P0-7 | 会话加固 | 生产 `JWT_EXPIRES_IN` 强制短 TTL（≤15m，缺省由代码兜底）；前端 `api/client.ts` 实现 401 → refresh → 重试，refresh 失败才踢出；`logout` 前后端联动 | `apps/api/src/auth/`、`apps/web/src/api/client.ts`、`apps/web/src/lib/auth.ts` | access token 15 分钟过期；前端静默刷新；登出撤销 refresh token |
| P0-8 | 角色类型与门禁修正 | 统一 `ParticipantRole = 'provider'\|'consumer'\|'operator'\|'compliance'`（在 `control-plane/index.ts` 单一来源导出，`User.participantRole` 引用同一类型）；审计/结算读取接口加 `@ParticipantRoles('compliance','operator')`，`by-user` 保留登录用户自身；`cp_participant.role` 同步类型 | `packages/database/src/control-plane/index.ts`、`apps/api/src/auth/`、`apps/api/src/audit/`、`apps/api/src/runtime/settlement/` | `@ParticipantRoles('compliance')` 可编译；consumer 读全量审计返回 403；合规视图后端有同权门禁 |
| P0-9 | 自注册兜底 | 注册成功不再直接发放可用会话（或发放 `status=pending` 会话）；登录后无角色用户进入"待完善/待审核"引导页，不能访问控制台业务页 | `apps/api/src/auth/auth.service.ts`、`apps/web/src/components/console/auth-gate.tsx` | 无角色用户看不到 SpaceNav 业务菜单，显示引导 CTA |
| P0-10 | Swagger 与 CORS | `SWAGGER_ENABLED` 环境开关（生产默认关）；`FRONTEND_URL` 生产必填校验，CORS 只允许配置域 | `apps/api/src/main.ts`、`DEPLOY.md` | 生产 `/api/docs` 404/关闭；跨域只放行配置域 |
| P0-11 | 最小用户管理 API | operator 专属：`GET /admin/users`、`PATCH /admin/users/:id`（分配 `participantId/participantRole`、启用/禁用）、`POST /admin/users/:id/reset-password` | `apps/api/src/` 新 `admin/` 或 `auth/admin.controller.ts`、前端最小列表页 | 运营可给自注册用户分配角色并启用；操作留审计 |

### 4.2 P1 — 图片登录流程与机构认证落地（正式运营核心）

| # | 任务 | 整改内容 | 涉及模块 | 验收标准 |
|---|---|---|---|---|
| P1-1 | 登录页重构 | 按图片实现居中登录弹窗：三 tab（账号密码 / 手机快捷 / CA证书登录）；账号密码 tab 含账号 + 图形验证码 + 密码（可见性切换）+ 登录按钮；底部"立即注册 / 忘记密码"；去 POC 徽标 | `apps/web/src/app/login/page.tsx` 重写 | 视觉与交互对齐图片；三 tab 可切换；验证码可刷新 |
| P1-2 | 手机快捷登录 | `User` 增加 `phone`（唯一、`@Masked('phone')`）；短信服务抽象（`SmsService`：生产接阿里云/腾讯云，开发用文件/控制台输出）；`POST /auth/sms/send`、`POST /auth/login/sms`；手机号验证码 5 分钟有效、5 次错误作废、60s 重发限制；未注册手机号首次登录自动建 `pending` 账号 | `packages/database`、`apps/api/src/auth/sms/`、前端 | 手机验证码可登录；限流与重放防护生效；TRUST.md 手机号字段控制点更新 |
| P1-3 | 机构认证数据模型 | 新增 `OrgCertificationApplication` 实体：`userId, orgType, orgName, uscc, licenseImagePath, validPeriod, region, address, businessScope, industry, capital, regDate, logoPath, caPublicKey, caCertFingerprint, status(draft/submitted/approved/rejected), reviewerId, reviewNote, step, createdAt/updatedAt` | `packages/database/src/control-plane/` 或 `entities/` | 迁移脚本 + 实体索引（userId、uscc、status） |
| P1-4 | 机构认证 API | `POST /account/certification`（保存草稿/提交）、`GET /account/certification`（我的申请）、`PUT /account/certification`（修改后重提）；operator 审核 `GET/POST /admin/certifications`（列表/通过/驳回+原因）；状态机：`draft→submitted→approved/rejected`，驳回可重提 | `apps/api/src/runtime/organization/` 新模块 | 申请可提交/修改/查看；审核状态可查；变更写审计 |
| P1-5 | 机构认证 UI | 用户中心（`/account`）→"账号与身份"→"机构认证"三步流程页：步骤 1 基本表单（机构类型/证照上传 JPG PNG ≤5M/机构名称/USCC 18 位校验/营业期限/注册地/详细地址/经营范围 1000 字/附加信息/LOGO ≤2M）；步骤 2 完善认证信息；步骤 3 完成机构入驻 | `apps/web/src/app/account/identity/` | 与图片字段逐项对齐；前端校验与后端 DTO 双层 |
| P1-6 | 证照与文件上传 | S3 兼容对象存储（`AWS_*`/`BUCKET_NAME` env 已存在）接入；文件类型/大小/格式白名单；生成随机 key 不暴露原文件名；访问走预签名 URL | `apps/api/src/common/uploads/`、前端上传组件 | 证照与 LOGO 可上传、预览、下载；非法文件拒绝；不落本地盘 |
| P1-7 | 用户 CA 身份凭证 | 新增 `UserCaCertificate`（`userId, identityName, publicKey, certFingerprint, status(active/revoked), issuedAt, validUntil`）；凭证生成三步：① 下载信通院接入连接器客户端（提供下载页/链接）② 客户端本地生成 SM2 密钥对，上传公钥 + 身份名称 ③ 平台 `CaService` 为用户签发 SM2 证书；私钥永不上传、服务端不存；换机可申请作废重发 | `apps/api/src/runtime/participant-identity/` 扩展、`apps/web/src/app/account/identity/ca/` | 用户可生成/查看/作废 CA 身份凭证；服务端无用户私钥；凭证可验签 |
| P1-8 | 忘记密码页面 | 邮箱验证码找回；手机验证码找回（与 P1-2 复用）；新密码不能与最近 3 次相同 | `apps/web/src/app/login/forgot/`、`apps/api/src/auth/` | 两种找回方式可用；重置后旧 refresh token 全部撤销 |
| P1-9 | 运营审核台 | operator 管理台：用户列表（搜索/筛选/分配角色/启用禁用）、机构认证审核（看证照/CA 凭证/通过/驳回）、连接器审核 | `apps/web/src/app/space/admin/` 或 `/account/admin`、`apps/api` | operator 可完成自注册用户 → 认证机构 → 角色分配闭环 |
| P1-10 | 门户频道与品牌 | 落地页导航改为图片样式频道：数据资源/数据产品/机构大厅/数据服务中心/需求大厅/行业空间/能力中心；公开目录/机构大厅数据来自 `catalog` 与 `cp_participant`；品牌去"原型演示"，SpaceNav "v0" 改为正式版本；新增运营中心信息页脚 | `apps/web/src/app/(landing)/page.tsx`、新增频道页 | 未登录访客可浏览公开频道；"原型演示"字样全站清除 |
| P1-11 | 用户中心菜单 | 用户中心左侧导航（账号与身份/我的收藏/安全设置）；顶部用户名下拉（个人中心/退出登录） | `apps/web/src/app/account/`、`SpaceNav` | 用户可查看/修改资料、查看认证状态、退出 |

### 4.3 P2 — 增强与生态对接（持续迭代）

| # | 任务 | 整改内容 | 优先级 |
|---|---|---|---|
| P2-1 | **CA 证书登录** | 设计挑战-签名流程：登录页生成随机挑战 → 信通院客户端（或本地 localhost 桥/浏览器扩展）用本地私钥 SM2 签名 → 平台用 `UserCaCertificate.publicKey` 验签 + 吊销检查 → 签发会话；不存储/不传输私钥 | 高 |
| P2-2 | **丝路数港身份互认** | 按 `docs/丝路数港-身份对接可行性评估.md` 结论，走 P2-8（区域功能节点对接）而非 P2-3：对接《数据基础设施接入指南》93 接口中的身份互认/目录同步/日志上报；本空间 CA 继续签发密码学身份 | 中 |
| P2-3 | 权威身份源 | 另选 OIDC/政务统一身份/法人库作为 P2-3"权威身份注册平台"适配器，注册联动机构认证 | 中 |
| P2-4 | 会话安全升级 | HttpOnly + Secure + SameSite Cookie 承载 refresh token（或保持 localStorage 但加指纹绑定）；CSRF 防护；MFA/TOTP 流程（复用 `User.mfaSecret/mfaEnabled`） | 中 |
| P2-5 | 审计报告导出 | 合规/运营可导出审计报告与证据包（PDF/JSON + SM3 链校验结果）；支持按时间/合约/参与方筛选 | 中 |
| P2-6 | 平台管理后台 | 拆分 `admin` 角色：空间管理、密钥/证书生命周期、开放平台应用管理（西安节点 `XIAN_APP_KEY` 配置化）、系统配置 | 中 |
| P2-7 | 数据模型与隐私对齐 | `User.phone` 加密存储与 `@Masked('phone')` 全链路；机构证照/LOGO 访问审计；`TRUST.md` 新增字段控制点 | 中 |

---

## 5. 数据模型变更清单

| 实体 | 字段 | 类型/约束 | 用途 |
|---|---|---|---|
| `User` | `phone` | varchar(20) null, unique, 加密 | 手机登录/短信 |
| `User` | `status` | varchar(20) default `active`（`active\|disabled\|pending`） | 账号生命周期 |
| `User` | `failedLoginCount` | int default 0 | 登录锁定 |
| `User` | `lockedUntil` | datetime null | 登录锁定 |
| `User` | `lastPasswordChangedAt` | datetime null | 密码策略 |
| `User` | `participantRole` | 引用统一 `ParticipantRole`（含 compliance） | 类型收口 |
| `OrgCertificationApplication`（新） | 见 P1-3 | control-plane | 机构认证申请 |
| `UserCaCertificate`（新） | 见 P1-7 | control-plane | 用户 CA 身份凭证 |
| `VerificationCode`（已落地） | `target, purpose, codeHash, expiresAt, usedAt, attempts` | 主库 | 邮箱+短信验证码合一（purpose 区分 reset_password / sms_login） |
| `CpParticipant` | `role` | 统一类型 | 与 User 角色一致 |

---

## 6. 验收标准（按身份场景）

| 身份 | 验收场景 |
|---|---|
| 访客 | 打开首页可见门户频道；可浏览公开数据产品/机构大厅；点击登录出现三 tab 弹窗；输入错误验证码被拒 |
| 待分配用户 | 注册 → 邮箱验证 → 登录进入"待完善"引导页；不能访问业务菜单；提示提交机构认证 |
| 提供方 | 机构认证三步提交 → 上传营业执照/USCC → 生成 CA 身份凭证（私钥留在本机）→ operator 审核通过 → 角色生效 → 可发布产品/绑定连接器 |
| 使用方 | 同上认证后 → 可申请数据产品/签合约/提交任务/收交付物 |
| 运营方 | 管理台可查用户、审核机构、启用/禁用账号、重置密码、看连接器状态 |
| 合规方 | 登录后访问合规/审计接口（后端门禁）；导出审计报告与证据包 |
| 管理员 | 管理空间、证书、开放平台应用，操作留痕 |
| 西安同步用户 | 免登进入后按同样流程补充机构认证与 CA 凭证 |

---

## 7. 里程碑建议

| 里程碑 | 内容 | 建议周期 |
|---|---|---|
| M0 | 冻结 POC：关闭演示账号/快速填充，全量回归 | 1 天 |
| M1 | P0 完成：账号生命周期、验证码、限流锁定、重置密码、角色门禁 | 1–2 周 |
| M2 | P1 完成：登录三方式（除 CA 登录外两方式 + CA 凭证生成）、机构认证三步、用户中心、运营审核台、门户频道 | 3–4 周 |
| M3 | P2 完成：CA 证书登录、丝路数港互认、会话安全升级、审计报告导出 | 4–6 周 |

---

## 8. 明确不做 / 风险提示

1. **不把丝路数港当作 OIDC/政务身份源**（已有 `docs/丝路数港-身份对接可行性评估.md` 结论）；其对接属于区域功能节点互认。
2. **用户 CA 私钥永不落服务端**；凭证生成与登录均走"本地签名、平台验签"。
3. **图形验证码/短信验证码答案只存哈希**，一次性、短时有效，防止拖库后伪造。
4. **不虚标 TEE 与国密能力**：登录安全整改不能与既有 `DECISIONS.md` D9 诚实标注原则冲突。
5. **迁移风险**：`User.participantRole` 类型收口会影响 `participant-roles.guard.ts` 与全部 `@ParticipantRoles` 调用点；需先跑全量测试与 `pnpm build`。
6. **存量演示数据**：正式运营前需清理演示账号、演示合约与演示任务，或迁移到隔离的演示空间。
