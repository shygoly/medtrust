# 西安节点三方应用身份认证集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MedTrust 作为「三方应用」接入国家数据流通利用基础设施·西安节点能力中心，按 PDF 协议实现用户同步接口与可信免登接口，使西安节点用户可免登进入 MedTrust。

**Architecture:** 在 NestJS 控制面新增 `runtime/xian-integration` 模块，暴露 `POST /api/v1/open-api/user/sync` 与 `POST /api/v1/open-api/login` 两个开放接口；接口按 PDF 校验 `X-App-Key`/`X-Timestamp`/`X-Nonce`，用我方 SM2 私钥解密敏感字段，把西安节点用户同步到本地 `users` 表并通过一次性 SSO ticket 生成免登 URL。现有 email+password 本地登录保留为兜底。

**Tech Stack:** NestJS 10、TypeORM/SQLite、sm-crypto（经 `GMCryptoService` 白名单收敛）、bcryptjs、Next.js 16、OpenSSL CLI（仅密钥生成脚本）。

**Spec:** `docs/国家数据流通利用基础设施西安节点_三方应用集成方案.pdf`（V1.2，2026-08-03）。关键章节：§4 安全机制（SM2 字段加密 + 请求头）、§5 通用规范、§6 用户同步接口、§7 免登接口、§8 三方应用处理要求、§9 响应码。本计划与 `docs/丝路数港-身份对接可行性评估.md` 结论一致：西安节点不做 OIDC 身份源，MedTrust 以**三方应用**身份接入其能力中心（对应 P2-8 区域节点对接，而非 P2-3 权威身份源）。

## Global Constraints

- 接口路径固定为 `{userSyncEndpoint}`、`{loginEndpoint}`（本计划取 `/api/v1/open-api/user/sync`、`/api/v1/open-api/login`，实际 URL 在能力中心注册时按部署域名配置）。
- 敏感字段密文 = Base64(SM2 密文字节)，不加 `ENC(...)` 包装；BC/Java 侧密文字节序为 **C1||C2||C3**（本计划已验证，sm-crypto `cipherMode=0` 对应）。
- SM2 公钥上传格式：Base64 X.509 SubjectPublicKeyInfo，无 PEM 头尾；私钥存我方为 PKCS#8 Base64（DER），运行时转 64 hex 标量。
- 请求头四件套必带：`X-App-Key`、`X-Timestamp`（`yyyy-MM-dd HH:mm:ss`）、`X-Nonce`、`X-Trace-Id`；`Content-Type: application/json; charset=utf-8`。
- 响应码只用 PDF §9 集合：`SUCCESS` / `INVALID_USER` / `ACCOUNT_DISABLED` / `LOGIN_EXPIRED` / `INVALID_NONCE` / `SYSTEM_ERROR`。
- 不得在日志打印用户密码；不得长期保存能力中心同步的密码明文；登录 token 与 URL 必须短时有效。
- `sm-crypto` 引用只允许出现在 `apps/api/src/security/crypto/`（TRUST.md 红线清单第 1 条）；新业务代码必须经 `GMCryptoService`。

---

### Task 1: GMCryptoService 增加 PDF 协议 SM2 字段加解密

**Files:**
- Modify: `apps/api/src/security/crypto/gm-crypto.service.ts`
- Test: `apps/api/src/security/crypto/gm-crypto.service.spec.ts`

**Interfaces:**
- Consumes: 现有 `sm2`（sm-crypto）、`assertValidSm2PrivateKey`
- Produces:
  - `sm2DecryptC1C2C3Base64(ciphertextBase64: string, privateKeyHex: string): string`
  - `sm2EncryptC1C2C3Base64(plaintext: string, publicKeyHex: string): string`
  - `extractSm2PrivateKeyHexFromPkcs8(pkcs8Base64: string): string`

- [ ] **Step 1: 在 `gm-crypto.service.ts` 增加三个方法**

在 `sm2Decrypt` 方法之后、`sm2Sign` 之前插入：

```ts
  /**
   * PDF 协议字段解密：Base64(SM2 密文字节) → 明文。
   * 密文字节序为 C1||C2||C3（Bouncy Castle `Cipher.getInstance("SM2")` 口径），
   * C1 含 04 前缀，因此先转 hex、去 04，再按 sm-crypto cipherMode=0 解密。
   */
  sm2DecryptC1C2C3Base64(
    ciphertextBase64: string,
    privateKeyHex: string,
  ): string {
    this.assertValidSm2PrivateKey(privateKeyHex);
    const bytes = Buffer.from(ciphertextBase64, "base64");
    let hex = bytes.toString("hex");
    if (hex.startsWith("04")) hex = hex.slice(2);
    const plaintext = sm2.doDecrypt(hex, privateKeyHex, 0);
    if (!plaintext) throw new Error("SM2 decryption failed");
    return plaintext;
  }

  /**
   * PDF 协议字段加密（仅测试/联调用）：明文 → Base64(SM2 密文字节)。
   * 生成与 BC 相同口径的 C1||C2||C3 密文。
   */
  sm2EncryptC1C2C3Base64(plaintext: string, publicKeyHex: string): string {
    const c1c2c3 = sm2.doEncrypt(plaintext, publicKeyHex, 0);
    return Buffer.from("04" + c1c2c3, "hex").toString("base64");
  }

  /**
   * 从 PKCS#8 DER（Base64）中提取 SM2 私钥 64 hex 标量。
   * PKCS#8 = SEQ{INTEGER 0, SEQ{OID ecPublicKey, OID SM2},
   * OCTET STRING{SEC1: SEQ{INTEGER 1, OCTET STRING(私钥), [0]OID, [1]公钥}}}。
   */
  extractSm2PrivateKeyHexFromPkcs8(pkcs8Base64: string): string {
    const buf = Buffer.from(pkcs8Base64, "base64");
    const readTlv = (b: Buffer, start: number) => {
      let pos = start;
      const tag = b[pos++];
      let len = b[pos++];
      if ((len & 0x80) !== 0) {
        const n = len & 0x7f;
        len = 0;
        for (let i = 0; i < n; i++) len = (len << 8) | b[pos++];
      }
      return { tag, len, contentStart: pos, end: pos + len };
    };
    const outer = readTlv(buf, 0);
    let p = outer.contentStart;
    p = readTlv(buf, p).end; // INTEGER version
    p = readTlv(buf, p).end; // SEQUENCE algId
    const oct = readTlv(buf, p); // OCTET STRING (SEC1 ECPrivateKey)
    const sec1 = buf.subarray(oct.contentStart, oct.end);
    const seq = readTlv(sec1, 0);
    let s = seq.contentStart;
    s = readTlv(sec1, s).end; // INTEGER version
    const privOct = readTlv(sec1, s); // OCTET STRING privateKey
    const scalar = sec1
      .subarray(privOct.contentStart, privOct.end)
      .toString("hex");
    this.assertValidSm2PrivateKey(scalar);
    return scalar;
  }
```

- [ ] **Step 2: 写失败测试**

在 `apps/api/src/security/crypto/gm-crypto.service.spec.ts` 的 `describe("SM2 Encryption/Decryption", ...)` 块内追加：

```ts
  describe("SM2 PDF-protocol (C1C2C3 Base64) interop", () => {
    it("roundtrips base64 C1C2C3 ciphertext", () => {
      const kp = service.generateSM2KeyPair();
      const ct = service.sm2EncryptC1C2C3Base64("13800138000", kp.publicKey);
      expect(ct).not.toContain("ENC(");
      expect(Buffer.from(ct, "base64").subarray(0, 1).toString("hex")).toBe("04");
      expect(service.sm2DecryptC1C2C3Base64(ct, kp.privateKey)).toBe(
        "13800138000",
      );
    });

    it("decrypts a Bouncy Castle SM2 ciphertext (PDF Java demo口径)", () => {
      const pkcs8 =
        "MIGTAgEAMBMGByqGSM49AgEGCCqBHM9VAYItBHkwdwIBAQQgs4gYMQlUQ+FVNggc" +
        "6c0Qeejz17RFQhlQJFIvVMPX16SgCgYIKoEcz1UBgi2hRANCAATGTycRnXSXYJhu" +
        "ctNAqU3wcmPt7CQs+cMjhfznjcL7jEnZy8vogM7Z1fkr2R9mbLJGP4Hmsb/UgVHi" +
        "KQHXHNdk";
      const cipherB64 =
        "BP9nuGbRoc18IpItJ895/kHTuB+QqbFLAptRMMCynGi5jgqvNUY/328Ai+TnMgnk" +
        "SlPZ5yIj+re2SkSBZpi5r3WdDcuGa+8QyjXotWgG2RjlgL6UQMnVrxwAxVKWN4eP" +
        "L8ra43egHsQT1adM";
      const scalar = service.extractSm2PrivateKeyHexFromPkcs8(pkcs8);
      expect(scalar).toHaveLength(64);
      expect(service.sm2DecryptC1C2C3Base64(cipherB64, scalar)).toBe(
        "13800138000",
      );
    });

    it("extractSm2PrivateKeyHexFromPkcs8 rejects malformed pkcs8", () => {
      expect(() =>
        service.extractSm2PrivateKeyHexFromPkcs8("AAAA"),
      ).toThrow();
    });
  });
```

- [ ] **Step 3: 跑测试确认先失败**

Run: `cd apps/api && pnpm test -- gm-crypto.service.spec.ts`
Expected: FAIL（新测试找不到三个方法 / 断言失败）。

- [ ] **Step 4: 实现代码（Step 1 已给出）**

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && pnpm test -- gm-crypto.service.spec.ts`
Expected: PASS（全部绿）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/security/crypto/gm-crypto.service.ts apps/api/src/security/crypto/gm-crypto.service.spec.ts
git commit -m "feat(security): add PDF-protocol SM2 C1C2C3 base64 crypto helpers"
```

---

### Task 2: 新增实体 `XianUserLink` 与 `SsoTicket`

**Files:**
- Create: `packages/database/src/entities/xian-user-link.entity.ts`
- Create: `packages/database/src/entities/sso-ticket.entity.ts`
- Modify: `packages/database/src/entities/index.ts`
- Modify: `DOMAIN.md`（覆盖矩阵加 2 行）

**Interfaces:**
- Produces:
  - `XianUserLink`：`tenantId: string`、`userId: string`、`localUserId: number`、`enterpriseName: string | null`、`unifiedSocialCreditCode: string | null`
  - `SsoTicket`：`ticketHash: string`、`userId: number`、`expiresAt: Date`、`usedAt: Date | null`

- [ ] **Step 1: 创建 `xian-user-link.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// 西安节点能力中心用户 → MedTrust 本地用户 绑定表（PDF §6 用户同步）。
// 能力中心 userId 是字符串且租户内唯一；(tenantId, userId) 作为天然幂等键。
@Entity("xian_user_links")
@Index(["tenantId", "userId"], { unique: true })
export class XianUserLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "tenant_id", length: 64 })
  tenantId: string;

  @Column({ name: "user_id", length: 128 })
  userId: string;

  @Index()
  @Column({ name: "local_user_id", type: "integer" })
  localUserId: number;

  // 企业认证信息只保留公开工商字段；法人证件号不落库（PDF V1.2 为可选项）。
  @Column({ name: "enterprise_name", length: 255, nullable: true })
  enterpriseName: string | null;

  @Column({
    name: "unified_social_credit_code",
    length: 64,
    nullable: true,
  })
  unifiedSocialCreditCode: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
```

- [ ] **Step 2: 创建 `sso-ticket.entity.ts`**

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

// 免登一次性票据（PDF §7）：能力中心拿到 loginUrl 后 302 给用户浏览器，
// 浏览器用 ticket 换本地会话；ticket 一次性、短时有效。
@Entity("sso_tickets")
export class SsoTicket {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column({ name: "ticket_hash", length: 64 })
  ticketHash: string;

  @Index()
  @Column({ name: "user_id", type: "integer" })
  userId: number;

  @Column({ name: "expires_at" })
  expiresAt: Date;

  @Column({ name: "used_at", type: "datetime", nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
```

- [ ] **Step 3: 更新 `packages/database/src/entities/index.ts`**

在末尾追加：

```ts
export * from './xian-user-link.entity';
export * from './sso-ticket.entity';
```

- [ ] **Step 4: 更新 `DOMAIN.md` 覆盖矩阵**

在 `DOMAIN.md` 的 `## 覆盖矩阵` 表末尾（`local_gold_standard` 行之后）加两行：

```markdown
| xian_user_links | control-plane | 租户与审计 |
| sso_tickets | control-plane | 租户与审计 |
```

- [ ] **Step 5: 构建 database 包并跑实体对拍**

Run:
```bash
cd packages/database && pnpm build
cd ../.. && node scripts/check-meta-docs.mjs
```
Expected: 无 `[ERR]`（覆盖矩阵与 @Entity 全表对拍通过；若 DOMAIN 缺行会报红）。

- [ ] **Step 6: Commit**

```bash
git add packages/database/src/entities/xian-user-link.entity.ts packages/database/src/entities/sso-ticket.entity.ts packages/database/src/entities/index.ts DOMAIN.md
git commit -m "feat(database): add XianUserLink and SsoTicket entities"
```

---

### Task 3: AuthService 增加免登 ticket 签发与兑换

**Files:**
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/dto/sso-exchange.dto.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `SsoTicket`（Task 2）、`User`、`RefreshToken`
- Produces:
  - `AuthService.createSsoTicket(userId: number): Promise<string>`
  - `AuthService.exchangeSsoTicket(rawTicket: string): Promise<{user, access_token, refresh_token}>`
  - `POST /api/v1/auth/sso/exchange` body `{ ticket: string }`

- [ ] **Step 1: 创建 `sso-exchange.dto.ts`**

```ts
import { IsNotEmpty, IsString } from "class-validator";

export class SsoExchangeDto {
  @IsString()
  @IsNotEmpty()
  ticket: string;
}
```

- [ ] **Step 2: 修改 `auth.module.ts` 注册 SsoTicket**

把 `TypeOrmModule.forFeature([User, RefreshToken])` 改为：

```ts
    TypeOrmModule.forFeature([User, RefreshToken, SsoTicket]),
```

并在 import 中加 `SsoTicket`：

```ts
import { User, RefreshToken, SsoTicket } from "@medtrust/database";
```

- [ ] **Step 3: 修改 `auth.service.ts`**

新增常量（在 `REFRESH_TTL_MS` 之后）：

```ts
const SSO_TICKET_TTL_MS =
  (Number(process.env.XIAN_LOGIN_TICKET_TTL_MS) || 60) * 1000;
```

构造函数注入 `ssoTickets`：

```ts
    @InjectRepository(SsoTicket)
    private readonly ssoTickets: Repository<SsoTicket>,
```

`typeorm` import 增加 `IsNull`：

```ts
import { IsNull, Repository } from "typeorm";
```

`@medtrust/database` import 增加 `SsoTicket`：

```ts
import { User, RefreshToken, SsoTicket } from "@medtrust/database";
```

新增两个方法（放在 `logout` 之后）：

```ts
  // 免登一次性 ticket（PDF §7）：只给 hash，原文只在 loginUrl 出现一次。
  async createSsoTicket(userId: number): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await this.ssoTickets.save(
      this.ssoTickets.create({
        ticketHash: this.hashToken(raw),
        userId,
        expiresAt: new Date(Date.now() + SSO_TICKET_TTL_MS),
      }),
    );
    return raw;
  }

  // 用一次性 ticket 兑换本地会话（access + refresh）。原子占用，防并发重放。
  async exchangeSsoTicket(rawTicket: string) {
    if (!rawTicket) throw new UnauthorizedException("Invalid SSO ticket");
    const row = await this.ssoTickets.findOne({
      where: { ticketHash: this.hashToken(rawTicket) },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid SSO ticket");
    }
    const claimed = await this.ssoTickets.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!claimed.affected) throw new UnauthorizedException("Invalid SSO ticket");
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("Invalid SSO ticket");
    }
    return this.session(user);
  }
```

- [ ] **Step 4: 修改 `auth.controller.ts` 增加兑换端点**

在 `logout` 之后加：

```ts
  @Post("sso/exchange")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Exchange a one-time Xian SSO ticket for a session" })
  @ApiResponse({ status: 200, description: "Session issued" })
  @ApiResponse({ status: 401, description: "Invalid/expired/reused ticket" })
  async exchangeSso(@Body() dto: SsoExchangeDto) {
    return this.authService.exchangeSsoTicket(dto.ticket);
  }
```

并 import `SsoExchangeDto`。

- [ ] **Step 5: 创建 `auth.service.spec.ts`**

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User, RefreshToken, SsoTicket } from "@medtrust/database";
import { AuthService } from "./auth.service";

describe("AuthService SSO tickets", () => {
  let service: AuthService;
  const users = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
  };
  const refreshTokens = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const ssoTickets = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v) => v),
    update: jest.fn(),
  };
  const jwtService = { sign: jest.fn(() => "jwt-token") };
  const configService = { get: jest.fn(() => "15m") };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getRepositoryToken(SsoTicket), useValue: ssoTickets },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it("createSsoTicket stores hash and returns raw ticket", async () => {
    ssoTickets.save.mockResolvedValue(undefined);
    const raw = await service.createSsoTicket(7);
    expect(raw).toBeTruthy();
    expect(ssoTickets.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
    );
    const saved = ssoTickets.save.mock.calls[0][0];
    expect(saved.ticketHash).not.toBe(raw);
  });

  it("exchangeSsoTicket returns session for valid ticket", async () => {
    const now = Date.now();
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: null,
      expiresAt: new Date(now + 60_000),
    });
    ssoTickets.update.mockResolvedValue({ affected: 1 });
    users.findOne.mockResolvedValue({
      id: 7,
      email: "xian@example.com",
      name: "雷军",
      participantId: "xian-40044",
      participantRole: "consumer",
      deletedAt: null,
    });
    refreshTokens.create.mockImplementation((v) => v);
    refreshTokens.save.mockResolvedValue(undefined);

    const session = await service.exchangeSsoTicket("raw-ticket");
    expect(session.access_token).toBe("jwt-token");
    expect(session.user.email).toBe("xian@example.com");
    expect(ssoTickets.update).toHaveBeenCalled();
  });

  it("exchangeSsoTicket rejects used ticket", async () => {
    ssoTickets.findOne.mockResolvedValue({
      id: "t1",
      userId: 7,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.exchangeSsoTicket("raw-ticket")).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/api && pnpm test -- auth.service.spec.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/auth.module.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/dto/sso-exchange.dto.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "feat(auth): add one-time SSO ticket issue and exchange"
```

---

### Task 4: 西安节点开放接口模块 `runtime/xian-integration`

**Files:**
- Create: `apps/api/src/runtime/xian-integration/xian-api-error.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-nonce.store.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-header.service.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-open-api.service.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-open-api.controller.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-integration.module.ts`
- Create: `apps/api/src/runtime/xian-integration/xian-header.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `GMCryptoService`（全局）、`AuthService`（Task 3）、`User`、`XianUserLink`（Task 2）
- Produces:
  - `POST /api/v1/open-api/user/sync`
  - `POST /api/v1/open-api/login`
  - `XianHeaderService.validate(headers): { traceId: string }`
  - `XianNonceStore.claim(nonce: string, ttlMs: number): boolean`

- [ ] **Step 1: 创建 `xian-api-error.ts`**

```ts
export type XianErrorCode =
  | "INVALID_USER"
  | "ACCOUNT_DISABLED"
  | "LOGIN_EXPIRED"
  | "INVALID_NONCE"
  | "SYSTEM_ERROR";

export class XianApiError extends Error {
  constructor(
    public readonly code: XianErrorCode,
    message?: string,
  ) {
    super(message || code);
  }
}
```

- [ ] **Step 2: 创建 `xian-nonce.store.ts`**

```ts
import { Injectable } from "@nestjs/common";

// 单实例内存 nonce 防重放（PDF §5.2 推荐 Redis，本地/单实例用 TTL Map）。
@Injectable()
export class XianNonceStore {
  private readonly seen = new Map<string, number>();

  claim(nonce: string, ttlMs: number): boolean {
    if (!nonce || nonce.length > 128) return false;
    const now = Date.now();
    const expireAt = this.seen.get(nonce);
    if (expireAt && expireAt > now) return false;
    this.seen.set(nonce, now + ttlMs);
    if (this.seen.size > 10_000) {
      for (const [k, v] of this.seen) if (v <= now) this.seen.delete(k);
    }
    return true;
  }
}
```

- [ ] **Step 3: 创建 `xian-header.service.ts`**

```ts
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { XianApiError } from "./xian-api-error";
import { XianNonceStore } from "./xian-nonce.store";

export interface XianHeaders {
  [name: string]: string | string[] | undefined;
}

@Injectable()
export class XianHeaderService {
  constructor(
    private readonly config: ConfigService,
    private readonly nonces: XianNonceStore,
  ) {}

  validate(headers: XianHeaders): { traceId: string } {
    const appKey = this.config.get<string>("XIAN_APP_KEY");
    if (!appKey) {
      throw new XianApiError("SYSTEM_ERROR", "XIAN_APP_KEY not configured");
    }

    const one = (name: string): string => {
      const v = headers[name];
      return String(Array.isArray(v) ? v[0] : v ?? "").trim();
    };

    if (one("x-app-key") !== appKey) {
      throw new XianApiError("SYSTEM_ERROR", "invalid X-App-Key");
    }

    const timestamp = one("x-timestamp");
    const offset = this.config.get<string>("XIAN_TIMESTAMP_TZ_OFFSET") || "+08:00";
    const ts = new Date(timestamp.replace(" ", "T") + offset).getTime();
    if (!Number.isFinite(ts)) {
      throw new XianApiError("LOGIN_EXPIRED", "invalid X-Timestamp");
    }
    const windowMs = Number(this.config.get("XIAN_TIMESTAMP_WINDOW_MS") || 300000);
    if (Math.abs(Date.now() - ts) > windowMs) {
      throw new XianApiError("LOGIN_EXPIRED", "X-Timestamp expired");
    }

    const nonce = one("x-nonce");
    if (!this.nonces.claim(nonce, windowMs)) {
      throw new XianApiError("INVALID_NONCE", "duplicate X-Nonce");
    }

    const traceId = one("x-trace-id");
    if (!traceId) {
      throw new XianApiError("SYSTEM_ERROR", "missing X-Trace-Id");
    }
    return { traceId };
  }
}
```

- [ ] **Step 4: 创建 `xian-open-api.service.ts`**

```ts
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { User, XianUserLink } from "@medtrust/database";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AuthService } from "../../auth/auth.service";
import { XianApiError } from "./xian-api-error";

interface EnterpriseInfo {
  enterpriseName?: string;
  unifiedSocialCreditCode?: string;
}

@Injectable()
export class XianOpenApiService {
  private readonly logger = new Logger(XianOpenApiService.name);
  private readonly privateKeyHex: string;

  constructor(
    private readonly config: ConfigService,
    private readonly gm: GMCryptoService,
    private readonly auth: AuthService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(XianUserLink)
    private readonly links: Repository<XianUserLink>,
  ) {
    const pkcs8 = this.config.get<string>("XIAN_SM2_PRIVATE_KEY_PKCS8_B64");
    this.privateKeyHex = pkcs8
      ? this.gm.extractSm2PrivateKeyHexFromPkcs8(pkcs8)
      : "";
  }

  async userSync(body: any) {
    this.assertConfigured();
    const requestId = this.str(body?.requestId);
    const tenantId = this.str(body?.tenantId);
    const userId = this.str(body?.userId);
    const userName = this.str(body?.userName);
    if (!requestId || !tenantId || !userId || !userName) {
      throw new XianApiError("SYSTEM_ERROR", "missing required fields");
    }

    const mobile = this.decryptField(body?.mobile);
    const email = this.decryptField(body?.email);
    const passwordPlain = this.decryptField(body?.password);
    const enterprise: EnterpriseInfo = body?.enterpriseInfo ?? {};

    const link = await this.links.findOne({ where: { tenantId, userId } });
    let user: User | null = null;

    if (link) {
      user = await this.users.findOne({ where: { id: link.localUserId } });
    } else {
      const emailToUse =
        email || `xian-${tenantId}-${userId}@xian-node.local`;
      user = await this.users.findOne({ where: { email: emailToUse } });
      if (!user) {
        const passwordHash = await bcrypt.hash(
          passwordPlain || randomBytes(12).toString("hex"),
          10,
        );
        user = await this.users.save(
          this.users.create({
            email: emailToUse,
            name: userName,
            passwordHash,
            participantId: `xian-${tenantId}`,
            participantRole: this.resolveRole(tenantId),
          }),
        );
      }
      await this.links.save(
        this.links.create({
          tenantId,
          userId,
          localUserId: user.id,
          enterpriseName: enterprise.enterpriseName ?? null,
          unifiedSocialCreditCode:
            enterprise.unifiedSocialCreditCode ?? null,
        }),
      );
    }

    if (user) {
      if (user.name !== userName) {
        user.name = userName;
      }
      if (passwordPlain) {
        user.passwordHash = await bcrypt.hash(passwordPlain, 10);
      }
      await this.users.save(user);
    }

    this.logger.log(
      `xian user sync ok: requestId=${requestId} tenant=${tenantId} user=${userId}`,
    );
    return { code: "SUCCESS", message: "user synchronized" };
  }

  async login(body: any) {
    this.assertConfigured();
    const tenantId = this.str(body?.tenantId);
    const userId = this.str(body?.userId);
    if (!tenantId || !userId) {
      throw new XianApiError("SYSTEM_ERROR", "missing required fields");
    }

    const link = await this.links.findOne({ where: { tenantId, userId } });
    if (!link) throw new XianApiError("INVALID_USER");
    const user = await this.users.findOne({ where: { id: link.localUserId } });
    if (!user || user.deletedAt) throw new XianApiError("ACCOUNT_DISABLED");

    const rawTicket = await this.auth.createSsoTicket(user.id);
    const base =
      this.config.get<string>("XIAN_WEB_BASE_URL") || "http://localhost:5020";
    return {
      code: "SUCCESS",
      message: "login success",
      data: {
        loginUrl: `${base}/login/sso?ticket=${encodeURIComponent(rawTicket)}`,
      },
    };
  }

  private assertConfigured(): void {
    if (!this.privateKeyHex) {
      throw new XianApiError(
        "SYSTEM_ERROR",
        "XIAN_SM2_PRIVATE_KEY_PKCS8_B64 not configured",
      );
    }
  }

  private decryptField(value: string | undefined): string {
    if (!value) return "";
    return this.gm.sm2DecryptC1C2C3Base64(value, this.privateKeyHex);
  }

  private str(value: unknown): string {
    return String(value ?? "").trim();
  }

  private resolveRole(tenantId: string): User["participantRole"] {
    const raw = this.config.get<string>("XIAN_TENANT_ROLE_MAP");
    try {
      const map = raw ? JSON.parse(raw) : {};
      const role = map[tenantId];
      return ["provider", "consumer", "operator", "compliance"].includes(role)
        ? role
        : "consumer";
    } catch {
      return "consumer";
    }
  }
}
```

注意：`mobile` 只解密用于校验与后续扩展，**不落库**；`email` 作为本地账号唯一键，缺失时生成合成邮箱；`password` 只以 bcrypt 哈希落库。

- [ ] **Step 5: 创建 `xian-open-api.controller.ts`**

```ts
import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { XianHeaderService, XianHeaders } from "./xian-header.service";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianApiError } from "./xian-api-error";

@ApiTags("Xian Open API")
@Controller("open-api")
export class XianOpenApiController {
  constructor(
    private readonly headers: XianHeaderService,
    private readonly service: XianOpenApiService,
  ) {}

  @Post("user/sync")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心用户同步（PDF §6）" })
  async userSync(@Body() body: any, @Headers() headers: XianHeaders) {
    try {
      this.headers.validate(headers);
      return this.service.userSync(body);
    } catch (e) {
      return this.toResponse(e);
    }
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心可信免登（PDF §7）" })
  async login(@Body() body: any, @Headers() headers: XianHeaders) {
    try {
      this.headers.validate(headers);
      return this.service.login(body);
    } catch (e) {
      return this.toResponse(e);
    }
  }

  private toResponse(e: unknown) {
    if (e instanceof XianApiError) {
      return { code: e.code, message: e.message };
    }
    return { code: "SYSTEM_ERROR", message: "system error" };
  }
}
```

- [ ] **Step 6: 创建 `xian-integration.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User, XianUserLink } from "@medtrust/database";
import { AuthModule } from "../../auth/auth.module";
import { XianOpenApiController } from "./xian-open-api.controller";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianHeaderService } from "./xian-header.service";
import { XianNonceStore } from "./xian-nonce.store";

// 西安节点能力中心三方应用集成（PDF §6/§7）：用户同步 + 可信免登。
@Module({
  imports: [TypeOrmModule.forFeature([User, XianUserLink]), AuthModule],
  controllers: [XianOpenApiController],
  providers: [XianOpenApiService, XianHeaderService, XianNonceStore],
})
export class XianIntegrationModule {}
```

- [ ] **Step 7: 注册到 `app.module.ts`**

在 import 中加：

```ts
import { XianIntegrationModule } from "./runtime/xian-integration/xian-integration.module";
```

在 `ComplianceModule` 之后加：

```ts
    XianIntegrationModule,
```

- [ ] **Step 8: 创建 `xian-header.service.spec.ts`**

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { XianHeaderService } from "./xian-header.service";
import { XianNonceStore } from "./xian-nonce.store";
import { XianApiError } from "./xian-api-error";

describe("XianHeaderService", () => {
  let service: XianHeaderService;
  const config = { get: jest.fn((key: string) => {
    if (key === "XIAN_APP_KEY") return "app-key-001";
    if (key === "XIAN_TIMESTAMP_TZ_OFFSET") return "+08:00";
    if (key === "XIAN_TIMESTAMP_WINDOW_MS") return "300000";
    return undefined;
  }) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XianHeaderService,
        XianNonceStore,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(XianHeaderService);
  });

  const validHeaders = () => ({
    "x-app-key": "app-key-001",
    "x-timestamp": new Date(Date.now() - 1000).toISOString().slice(0, 19).replace("T", " "),
    "x-nonce": Math.random().toString(36).slice(2),
    "x-trace-id": "trace-1",
  });

  it("accepts valid headers", () => {
    expect(service.validate(validHeaders()).traceId).toBe("trace-1");
  });

  it("rejects duplicate nonce as INVALID_NONCE", () => {
    const h = validHeaders();
    service.validate(h);
    expect(() => service.validate(h)).toThrow(XianApiError);
    try { service.validate(h); } catch (e) {
      expect((e as XianApiError).code).toBe("INVALID_NONCE");
    }
  });

  it("rejects expired timestamp as LOGIN_EXPIRED", () => {
    const h = validHeaders();
    const old = new Date(Date.now() - 10 * 60_000);
    h["x-timestamp"] = old.toISOString().slice(0, 19).replace("T", " ");
    try { service.validate(h); } catch (e) {
      expect((e as XianApiError).code).toBe("LOGIN_EXPIRED");
    }
  });
});
```

注意：`validHeaders` 中 `x-timestamp` 用 ISO 前 19 位，格式 `yyyy-MM-dd HH:mm:ss`，但时区为 UTC。测试把 `Date.now() - 1000` 转 ISO 后拼 `+08:00` 会与北京时间差 8 小时——所以测试应改用北京时间字符串。修正 `validHeaders`：

```ts
  const validHeaders = () => {
    const now = new Date(Date.now() + 8 * 3600_000);
    const ts = now.toISOString().slice(0, 19).replace("T", " ");
    return {
      "x-app-key": "app-key-001",
      "x-timestamp": ts,
      "x-nonce": Math.random().toString(36).slice(2),
      "x-trace-id": "trace-1",
    };
  };
```

- [ ] **Step 9: 跑测试**

Run: `cd apps/api && pnpm test -- xian-header.service.spec.ts`
Expected: PASS。

- [ ] **Step 10: 编译整个 API**

Run: `cd apps/api && pnpm build`
Expected: 无 TS 错误。

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/runtime/xian-integration apps/api/src/app.module.ts
git commit -m "feat(api): add Xian node open-api user sync and trusted SSO endpoints"
```

---

### Task 5: Web 免登落地页与 API client

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/app/login/sso/page.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/auth/sso/exchange`（Task 3）
- Produces: `/login/sso?ticket=...` 页面，兑换成功后 `saveSession` 并跳转 `/space`

- [ ] **Step 1: `api/client.ts` 增加 `exchangeSsoTicket`**

在 `register` 方法之后加：

```ts
  async exchangeSsoTicket(ticket: string) {
    return this.request<AuthResponse>('/auth/sso/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    });
  }
```

- [ ] **Step 2: 创建 `apps/web/src/app/login/sso/page.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api/client';
import { saveSession } from '@/lib/auth';

export default function SsoLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const ticket = new URLSearchParams(window.location.search).get('ticket');
    if (!ticket) {
      setError('缺少登录票据，请从西安节点工作台重新进入应用。');
      return;
    }
    api
      .exchangeSsoTicket(ticket)
      .then((res) => {
        saveSession(res.access_token, res.user);
        router.replace('/space');
      })
      .catch((err) => {
        setError(err.message || '免登失败');
      });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow text-center">
        <h2 className="text-2xl font-bold">MedTrust 免登</h2>
        {error ? (
          <>
            <p className="mt-4 text-red-500 text-sm">{error}</p>
            <Link href="/login" className="mt-4 inline-block text-blue-600 text-sm">
              返回本地登录
            </Link>
          </>
        ) : (
          <p className="mt-4 text-gray-600 text-sm">正在验证登录票据…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 本地构建 web**

Run: `cd apps/web && pnpm build`
Expected: 无 TS/ESLint 错误（Next 构建通过）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/app/login/sso/page.tsx
git commit -m "feat(web): add Xian SSO ticket exchange landing page"
```

---

### Task 6: SM2 密钥生成脚本与环境变量登记

**Files:**
- Create: `scripts/generate-xian-sm2-keys.sh`
- Modify: `.env.example`
- Modify: `DEPLOY.md`（§2 环境变量表加 6 行）

**Interfaces:**
- Produces: `XIAN_SM2_PRIVATE_KEY_PKCS8_B64`、`XIAN_SM2_PUBLIC_KEY_SPKI_B64`（后者上传能力中心「添加应用」表单）

- [ ] **Step 1: 创建 `scripts/generate-xian-sm2-keys.sh`**

```bash
#!/usr/bin/env bash
# 生成西安节点三方应用 SM2 密钥对（PDF §4.3）。
# 输出：
#   XIAN_SM2_PRIVATE_KEY_PKCS8_B64  我方私钥（PKCS#8 DER Base64，存 .env / fly secrets）
#   XIAN_SM2_PUBLIC_KEY_SPKI_B64    公钥（X.509 SPKI Base64，上传能力中心，不含 PEM 头尾）
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl ecparam -genkey -name SM2 -out "$TMP/priv.pem"
openssl pkcs8 -topk8 -nocrypt -in "$TMP/priv.pem" -outform DER -out "$TMP/priv.der"
openssl ec -in "$TMP/priv.pem" -pubout -outform DER -out "$TMP/pub.der"

echo "XIAN_SM2_PRIVATE_KEY_PKCS8_B64=$(base64 < "$TMP/priv.der" | tr -d '\n')"
echo "XIAN_SM2_PUBLIC_KEY_SPKI_B64=$(base64 < "$TMP/pub.der" | tr -d '\n')"
echo "# 将上面公钥 Base64 原文（不含 PEM 头尾）上传到西安节点能力中心「添加应用」表单。"
```

执行：`chmod +x scripts/generate-xian-sm2-keys.sh`

- [ ] **Step 2: `.env.example` 增加 XIAN 块**

在 `# External Services - FHIR` 块之后加：

```dotenv
# Xian node open-api (国家数据流通利用基础设施·西安节点 三方应用集成)
XIAN_APP_KEY=
XIAN_SM2_PRIVATE_KEY_PKCS8_B64=
XIAN_WEB_BASE_URL=http://localhost:5020
XIAN_TIMESTAMP_TZ_OFFSET=+08:00
XIAN_TIMESTAMP_WINDOW_MS=300000
XIAN_LOGIN_TICKET_TTL_MS=60000
XIAN_TENANT_ROLE_MAP={"40044":"provider"}
```

- [ ] **Step 3: `DEPLOY.md` §2 环境变量表加行**

在 `CONNECTOR_*` 块之后（或按字母序合适位置）加：

```markdown
| `XIAN_APP_KEY` | api | 否 | 是 | 空 | 西安节点能力中心分配的三方应用访问标识（PDF §5.2），空则开放接口返回 SYSTEM_ERROR |
| `XIAN_LOGIN_TICKET_TTL_MS` | api | 否 | 否 | `60000` | 免登一次性 ticket 有效期（毫秒），PDF §8 要求登录 URL 短时有效 |
| `XIAN_SM2_PRIVATE_KEY_PKCS8_B64` | api | 否 | 是 | 空 | 我方 SM2 私钥（PKCS#8 DER Base64），解密能力中心下发的敏感字段 |
| `XIAN_TENANT_ROLE_MAP` | api | 否 | 否 | 空 | 西安 tenantId → participantRole 映射 JSON；未命中默认 `consumer` |
| `XIAN_TIMESTAMP_TZ_OFFSET` | api | 否 | 否 | `+08:00` | X-Timestamp 解析时区（西安节点为北京时间） |
| `XIAN_TIMESTAMP_WINDOW_MS` | api | 否 | 否 | `300000` | X-Timestamp / X-Nonce 防重放时间窗（毫秒），PDF §5.2 建议 5 分钟 |
| `XIAN_WEB_BASE_URL` | api | 否 | 否 | `http://localhost:5020` | 免登 loginUrl 的 web 基地址（含协议，不含尾部斜杠） |
```

- [ ] **Step 4: 验证 DEPLOY 对拍**

Run: `node scripts/check-meta-docs.mjs`
Expected: 无 `[ERR]`（新增 env 读取点与 DEPLOY 表对拍通过）。

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-xian-sm2-keys.sh .env.example DEPLOY.md
git commit -m "chore(config): add Xian node SM2 keygen script and env registration"
```

---

### Task 7: 治理元语更新与全量验证

**Files:**
- Modify: `DECISIONS.md`（新增 `D-ID-2`）
- Modify: `TRUST.md`（新增 `CTL-18`）
- Modify: `DOMAIN.md`（已在 Task 2 加覆盖矩阵行；如未加，此处补齐）

**Interfaces:** 无

- [ ] **Step 1: `DECISIONS.md` 在 `D-ID-1` 之后新增 `D-ID-2`**

```markdown
### D-ID-2：西安节点身份对接走「三方应用集成」，不替代本地身份体系

```yaml decision
id: D-ID-2
title: 以三方应用身份接入西安节点能力中心的用户同步与可信免登，本地 email/password 与 SM2 CA 连接器身份保持不变
status: accepted
date: 2026-08
context: |
  西安节点《三方应用集成方案》只定义能力中心→三方应用的用户同步与免登两个接口，
  不是 OIDC/政务身份源。MedTrust 作为被集成应用，新增开放接口接收同步用户并
  签发本地会话，本地 JWT 体系与连接器 SM2 证书体系不被替换。
decision: |
  新增 runtime/xian-integration 模块实现 PDF 的 userSyncEndpoint 与 loginEndpoint；
  免登经一次性 SSO ticket 兑换本地 JWT 会话。本地登录保留为兜底。
references:
  - docs/国家数据流通利用基础设施西安节点_三方应用集成方案.pdf
  - docs/丝路数港-身份对接可行性评估.md
code_markers:
  - apps/api/src/runtime/xian-integration/xian-integration.module.ts
```

- [ ] **Step 2: `TRUST.md` 在 `CTL-17` 之后新增 `CTL-18`**

````markdown
```yaml control
id: CTL-18
title: 西安节点开放接口防重放与敏感字段 SM2 加密（X-App-Key + 时间窗 + nonce + SM2 字段解密）
norm: [D-ID-2, 等保2.0 身份鉴别, 个保法·敏感个人信息]
threat: 开放接口被重放/伪造调用；SM2 密文字段被明文日志或明文落库
enforcement:
  - ts:apps/api/src/runtime/xian-integration/xian-header.service.ts#XianHeaderService
  - ts:apps/api/src/runtime/xian-integration/xian-open-api.service.ts#XianOpenApiService
  - ts:apps/api/src/security/crypto/gm-crypto.service.ts#GMCryptoService
db: xian_user_links(tenantId,userId) + sso_tickets(ticketHash,usedAt)
spec: apps/api/src/runtime/xian-integration/xian-header.service.spec.ts
evidence: X-Timestamp 5 分钟窗、X-Nonce 去重、SM2 字段密文 Base64 直传；密码不落明文/不入日志，仅 bcrypt 哈希落 users.password_hash
```
````

- [ ] **Step 3: 跑治理校验**

Run: `cd /Users/mac/Sync/project/medtrust && pnpm check:meta`
Expected: 无 `[ERR]`（DECISIONS/TRUST/DOMAIN 全部对拍通过）。如有 `[WARN]`，先阅读但不阻塞。

- [ ] **Step 4: 跑全量测试**

Run: `cd /Users/mac/Sync/project/medtrust && pnpm test`
Expected: 全部 PASS（至少包含 Task 1/3/4 新增测试）。

- [ ] **Step 5: 手动联调（本机模拟能力中心）**

```bash
# 终端 A：API
cd apps/api && pnpm dev
# 终端 B：web
cd apps/web && pnpm dev
# 终端 C：生成密钥、配置 XIAN_APP_KEY 后重启 API，然后用 BC/PDF Java demo 或 Node 脚本构造加密请求
curl -s http://localhost:5021/api/v1/open-api/user/sync \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H 'X-App-Key: app-key-001' \
  -H "X-Timestamp: $(date -u +%Y-%m-%dT%H:%M:%S)" \
  -H 'X-Nonce: nonce-000001' \
  -H 'X-Trace-Id: trace-000001' \
  -d '{"requestId":"r1","tenantId":"40044","userId":"u1","userName":"雷军","mobile":"<SM2密文Base64>","email":"<SM2密文Base64>","password":"<SM2密文Base64>"}'
# 期望：{"code":"SUCCESS","message":"user synchronized"}
```

注意：`X-Timestamp` 需为 `yyyy-MM-dd HH:mm:ss`（北京时间），非 ISO `T` 格式；上面 curl 仅示意，实际联调用 PDF 附录 Java Demo 或本计划 Task 1 的 `sm2EncryptC1C2C3Base64` 生成密文。

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md TRUST.md
git commit -m "docs(governance): register D-ID-2 and CTL-18 for Xian node identity integration"
```

---

## Self-Review

**Spec coverage:**
- PDF §4.1/§4.2/§4.3 SM2 公钥上传与字段加密 → Task 1（C1C2C3 Base64 加解密）+ Task 6（X.509 SPKI 公钥生成）。
- PDF §5.2 请求头四件套 + 时间窗 + nonce → Task 4（XianHeaderService + XianNonceStore）。
- PDF §6 用户同步接口（创建/更新/权限初始化）→ Task 4（XianOpenApiService.userSync）。
- PDF §7 免登接口（校验用户→生成登录态→返回带 token URL）→ Task 3（SSO ticket）+ Task 4（login）+ Task 5（web 落地页）。
- PDF §8 处理要求（不打印密码、token 短时有效、nonce/时间戳校验）→ Task 4 与 Task 3。
- PDF §9 响应码 → Task 4（XianApiError + controller toResponse）。
- 本地身份体系保留 → Task 4 备注与 D-ID-2。

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含可直接粘贴的实现与测试。

**Type consistency:**
- `XianHeaderService.validate(headers: XianHeaders): { traceId: string }` 在 controller 与 spec 中一致。
- `AuthService.createSsoTicket(userId: number): Promise<string>` / `exchangeSsoTicket(rawTicket: string)` 在 Task 3 定义、Task 4 消费，签名一致。
- `GMCryptoService` 三个新方法在 Task 1 定义，Task 4 消费 `extractSm2PrivateKeyHexFromPkcs8` 与 `sm2DecryptC1C2C3Base64`，命名一致。
- 实体 `XianUserLink`/`SsoTicket` 在 Task 2 定义，Task 3/4/7 引用一致。
