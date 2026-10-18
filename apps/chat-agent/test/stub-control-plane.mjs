import { createServer } from 'node:http';

/**
 * E2E 用的控制面桩（端口 5099）。
 *
 * 浏览器 → chat-agent 这一段是**真的**（CORS、请求头、会话、卡片、HTTP）；
 * 只有控制面这一跳是桩——真控制面需要 DB/种子/已签合约，不适合放进浏览器 E2E。
 *
 * 桩要**如实模拟控制面的准入判据**，否则测试会测出假绿灯：
 * 合约必须 存在 + 持有方已签名 + mdopStatus=active + 未过期 + 用途编码相符
 * （对照 apps/api/src/runtime/digital-contract/mdop-contract.service.ts 的 assertUsableForJob）。
 */

const CATALOG = {
  items: [
    { id: 'dp-trial', title: '试验组数据', providerId: 'p-sponsor' },
    { id: 'dp-controls', title: '对照组数据', providerId: 'p-hosp-a' },
  ],
  total: 2,
};

/** 与 chat-agent 提交时带的 purpose 对齐（控制面是按**相等**比对的）。 */
const PURPOSE = '对话式任务配置（AI Chat Agent）';

const SIGNED_CONTRACT = {
  id: 'ct-e2e-1',
  providerId: 'p-hosp-a',
  consumerId: 'p-sponsor',
  status: 'active',
  mdopStatus: 'active',
  validUntil: '2027-01-14T00:00:00.000Z',
  purpose: PURPOSE,
  mdopTerms: { purposeCode: PURPOSE },
  holderSignature: 'sig-holder',
  platformCountersignature: 'sig-platform',
  consumerAcknowledgedAt: '2026-10-01T00:00:00.000Z',
};

/** 便于用例按需切换：未签名 / 已过期 / 用途不符（用环境变量控制，默认"可用"）。 */
function baseContracts() {
  const mode = state.contractMode;
  if (mode === 'unsigned') return [{ ...SIGNED_CONTRACT, holderSignature: null }];
  if (mode === 'expired') return [{ ...SIGNED_CONTRACT, validUntil: '2020-01-01T00:00:00.000Z' }];
  if (mode === 'missing') return [];
  return [SIGNED_CONTRACT];
}

/**
 * 可变状态 + 测试控制端点。
 *
 * 为什么需要：浏览器级用例要验的是**状态迁移**（无合约 → 申请 → 提供方签发 → 提交成功），
 * 而 `STUB_CONTRACT_MODE` 只能在整个 stub 进程里定一次。这里让用例在跑之前重置状态，
 * 并显式触发"签发"这一步——签发在真实系统里由医院侧连接器完成（D-MDOP-4），
 * agent 侧没有这条路，所以必须由测试**扮演医院**，不能偷偷在 chat-agent 里补。
 */
const DEFAULT_ACCESS_GRANTS = [
  { id: 'grant-e2e-1', dataProductId: 'dp-trial', providerId: 'p-sponsor', granteeParticipantId: 'p-sponsor', permissions: ['compute'], status: 'active', grantedAt: '2026-10-01T00:00:00.000Z', expiresAt: null },
  { id: 'grant-e2e-2', dataProductId: 'dp-controls', providerId: 'p-hosp-a', granteeParticipantId: 'p-sponsor', permissions: ['compute'], status: 'active', grantedAt: '2026-10-01T00:00:00.000Z', expiresAt: null },
];

const state = {
  contractMode: process.env.STUB_CONTRACT_MODE ?? 'usable',
  /** 药企提交的合约申请（真实控制面里 draft 对双方可见） */
  requested: [],
  auditEntries: [],
  /**
   * 产品级访问授权（D-ACL-1）。缺省给演示用产品开好权限；用例可以清空它来验"未授权被拦"。
   * 结构与控制面 `cp_data_access_grant` 对齐（只保留判定需要的字段）。
   */
  grants: [...DEFAULT_ACCESS_GRANTS],
  accessChecks: [],
  /**
   * 院内连接器的合约策略是否"自动确认"（真实系统里由医院本地策略文件决定，
   * 平台无法影响）。缺省 false = 人工确认。
   */
  connectorAutoSign: false,
};

/** 草稿：已提交申请但**未**由提供方签发（既没有持有方签名，也不是 active）。 */
function draftFrom(body, index) {
  return {
    id: `ct-req-${index}`,
    providerId: 'p-hosp-a',
    consumerId: 'p-sponsor',
    status: 'draft',
    mdopStatus: 'unsigned',
    dataProductId: body?.dataProductId ?? null,
    purpose: body?.purpose ?? null,
    retention: body?.retention ?? null,
    output: body?.output ?? null,
    preReviewCompositionId: body?.compositionId ?? null,
    validUntil: new Date(Date.now() + (body?.validDays ?? 30) * 86_400_000).toISOString(),
  };
}

/** 控制面里的合约列表 = 基线 + 申请中的草稿（+ 已签发）。 */
function contracts() {
  return [...baseContracts(), ...state.requested];
}

/**
 * 给 Web 控制台看的行形状（真控制面按调用者 role/participant 计算 `canApprove`）。
 * 桩没有 JWT 解析，就直接按"提供方视角"给 draft 开签发权——**只有演示里会用**，
 * 且演示中打开这一页的是医院账号（见 test/e2e/support/chat-demo.ts 的账号装置）。
 */
function contractRows() {
  return contracts().map((item) => ({
    ...item,
    effectiveStatus: item.status,
    canApprove: item.status === 'draft' && item.providerId === 'p-hosp-a',
    preReview: { verdict: 'pass', overallRisk: 'low' },
  }));
}

/** 当前**可用于作业**的合约 id（存在 + 持有方签名 + mdopStatus=active + 未过期）。 */
function usableContractIds() {
  return contracts()
    .filter(
      (item) =>
        item.holderSignature &&
        item.mdopStatus === 'active' &&
        new Date(item.validUntil).getTime() > Date.now(),
    )
    .map((item) => item.id);
}

/**
 * 访问授权判定（与控制面 `DataAccessService.check()` 同一口径，含 fail-closed）：
 * 没有 active、未过期、权限匹配的授权行 → 拒绝。提供方访问自己的产品不算自授。
 */
function checkDataAccess(dataProductId, participantId, permission = 'compute', now = Date.now()) {
  const product = CATALOG.items.find((item) => item.id === dataProductId);
  const providerId = product?.providerId ?? null;
  if (providerId && providerId === participantId) {
    return { allowed: true, reason: 'provider-self', permissions: ['catalog', 'compute'] };
  }
  const rows = state.grants.filter(
    (g) => g.dataProductId === dataProductId && g.granteeParticipantId === participantId,
  );
  const active = rows.find((g) => g.status === 'active');
  if (!active) {
    return { allowed: false, reason: rows.some((g) => g.status === 'revoked') ? 'revoked' : 'no-grant', permissions: [] };
  }
  if (active.expiresAt && new Date(active.expiresAt).getTime() <= now) {
    return { allowed: false, reason: 'expired', permissions: active.permissions, grantId: active.id, expiresAt: active.expiresAt };
  }
  if (!(active.permissions ?? []).includes(permission)) {
    return { allowed: false, reason: 'permission-missing', permissions: active.permissions, grantId: active.id };
  }
  return { allowed: true, reason: 'granted', permissions: active.permissions, grantId: active.id, expiresAt: active.expiresAt ?? null };
}

/**
 * 提供方签发一份草稿：医院用本院私钥签 `ContractAgree` → 合约 active（D-MDOP-4）。
 * 真实系统里这一步发生在医院侧连接器；桩在这里扮演它（网页上的点击照常是真实交互）。
 */
function issueDraft(target, ack) {
  Object.assign(target, {
    status: 'active',
    mdopStatus: 'active',
    mdopTerms: { purposeCode: PURPOSE },
    holderSignature: 'sig-holder',
    platformCountersignature: 'sig-platform',
    consumerAcknowledgedAt: new Date().toISOString(),
    // 需审批预审的确认理由计入合约哈希（真控制面如此）；桩只留档，便于用例断言留痕
    ...(ack?.preReviewAck?.reason ? { preReviewAck: ack.preReviewAck } : {}),
  });
  return target;
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const parsed = body ? JSON.parse(body) : null;

    if (req.method === 'GET' && req.url.startsWith('/api/v1/public/catalog')) {
      res.end(JSON.stringify(CATALOG));
      return;
    }

    // 本人的空间与角色（合规检查用调用者 token 问它）
    if (req.method === 'GET' && req.url === '/api/v1/auth/spaces') {
      res.end(
        JSON.stringify({
          spaces: ['sh-med'],
          spaceId: 'sh-med',
          memberships: [{ spaceId: 'sh-med', role: 'consumer' }],
        }),
      );
      return;
    }

    // 本人可见合约（合规前置闸读它）
    if (req.method === 'GET' && req.url.startsWith('/api/v1/contracts')) {
      res.end(JSON.stringify(contractRows()));
      return;
    }

    /**
     * 医院签发（真实路径：`POST /contracts/:id/approve`，医院网页上点「签发」）。
     *
     * 桩扮演的是**连接器**那一步（用本院私钥签 ContractAgree，D-MDOP-4）：网页点击照常走，
     * 签名由桩完成——这样浏览器级用例验的是"人在界面上点签发"，而不是测试后门。
     */
    const approveMatch = req.url.match(/^\/api\/v1\/contracts\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const target = state.requested.find((item) => item.id === approveMatch[1]);
      if (!target) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: `待签发的申请 ${approveMatch[1]} 不存在` }));
        return;
      }
      issueDraft(target, parsed);
      res.end(JSON.stringify({ ...target, effectiveStatus: 'active' }));
      return;
    }

    /**
     * 预授权自动推进（Phase 3 / D-MDOP-9）：`POST /contracts/:id/auto-offer`。
     *
     * 平台侧前置 = 提供方对（产品 × 使用方）有 active、compute 的授权；
     * 是否**真的自动签**取决于院内连接器的本地策略——桩里用 `connectorAutoSign` 表示，
     * **缺省 false**（与连接器"缺省人工确认"一致：自动必须显式打开）。
     */
    const autoOfferMatch = req.url.match(/^\/api\/v1\/contracts\/([^/]+)\/auto-offer$/);
    if (req.method === 'POST' && autoOfferMatch) {
      const target = state.requested.find((item) => item.id === autoOfferMatch[1]);
      if (!target) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: `待推进的申请 ${autoOfferMatch[1]} 不存在` }));
        return;
      }
      const grant = state.grants.find(
        (g) =>
          g.dataProductId === target.dataProductId &&
          g.granteeParticipantId === target.consumerId &&
          g.status === 'active' &&
          (g.permissions ?? []).includes('compute'),
      );
      if (!grant) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            message: '提供方尚未预授权该使用方访问该数据产品（no-grant），自动推进不适用',
          }),
        );
        return;
      }
      target.autoOfferGrantId = grant.id;
      target.autoOfferedAt = new Date().toISOString();
      target.mdopStatus = 'offered';
      if (state.connectorAutoSign) issueDraft(target, parsed);
      res.end(
        JSON.stringify({
          grantId: grant.id,
          offered: true,
          offerId: `offer:${target.id}:stub`,
          contract: { id: target.id, status: target.status },
        }),
      );
      return;
    }

    const rejectMatch = req.url.match(/^\/api\/v1\/contracts\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const index = state.requested.findIndex((item) => item.id === rejectMatch[1]);
      if (index < 0) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: `待审批的申请 ${rejectMatch[1]} 不存在` }));
        return;
      }
      const [draft] = state.requested.splice(index, 1);
      res.end(JSON.stringify({ ...draft, status: 'revoked', effectiveStatus: 'revoked' }));
      return;
    }

    // 本方创建的合规预审（合约申请必须引用一份，D-CMP-2）
    if (req.method === 'GET' && req.url.startsWith('/api/v1/compositions')) {
      res.end(
        JSON.stringify([
          {
            id: 'comp-e2e-1',
            scenarioKey: 'rws.external-control',
            verdict: 'pass',
            overallRisk: 'low',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        ]),
      );
      return;
    }

    // 药企发起合约申请 → 生成草稿（真实控制面还要重裁决预审，桩只校验必填与预审归属）
    if (req.method === 'POST' && req.url === '/api/v1/contracts/requests') {
      const missing = ['dataProductId', 'compositionId', 'purpose', 'retention', 'output'].filter(
        (key) => !parsed?.[key],
      );
      if (missing.length > 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: `缺少字段：${missing.join(', ')}` }));
        return;
      }
      if (parsed.compositionId !== 'comp-e2e-1') {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: '引用的合规预审不存在' }));
        return;
      }
      const draft = draftFrom(parsed, state.requested.length + 1);
      state.requested.push(draft);
      res.end(JSON.stringify(draft));
      return;
    }

    // 平台审计日志（agent 的合规动作写这里；桩只收不退，便于用例断言）
    if (req.method === 'POST' && req.url === '/api/v1/audit') {
      state.auditEntries.push(parsed);
      res.end(JSON.stringify({ id: state.auditEntries.length }));
      return;
    }

    // ── 测试控制端点（仅桩；用例用它重置状态与扮演"医院签发"）───────────────
    if (req.method === 'POST' && req.url === '/api/v1/__test__/state') {
      state.contractMode = parsed?.contractMode ?? 'usable';
      state.requested = [];
      state.auditEntries = [];
      state.accessChecks = [];
      // 授权表：缺省回到默认（演示用产品都已授权）；传数组则替换
      // （[] = 让用例从"没有任何授权"开始，验 ACL 的 fail-closed）
      state.grants = Array.isArray(parsed?.grants)
        ? [...parsed.grants]
        : [...DEFAULT_ACCESS_GRANTS];
      if (typeof parsed?.connectorAutoSign === 'boolean')
        state.connectorAutoSign = parsed.connectorAutoSign;
      res.end(JSON.stringify({ ...state, requested: state.requested.length }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/__test__/state') {
      res.end(
        JSON.stringify({
          contractMode: state.contractMode,
          requested: state.requested,
          usableContractIds: usableContractIds(),
          auditEntries: state.auditEntries,
          grants: state.grants,
          accessChecks: state.accessChecks,
          connectorAutoSign: state.connectorAutoSign,
        }),
      );
      return;
    }
    // 产品级访问授权判定（agent 的 `check_data_access` / 提交前闸都问它）
    if (req.method === 'GET' && req.url.startsWith('/api/v1/data-access/check')) {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const dataProductId = q.get('dataProductId');
      const participantId = q.get('participantId') ?? 'p-sponsor'; // 演示里问的是药企自己
      const permission = q.get('permission') ?? 'compute';
      const verdict = checkDataAccess(dataProductId, participantId, permission);
      state.accessChecks.push({ dataProductId, participantId, permission, allowed: verdict.allowed, reason: verdict.reason });
      res.end(
        JSON.stringify({
          ...verdict,
          dataProductId,
          participantId,
          providerId: CATALOG.items.find((item) => item.id === dataProductId)?.providerId ?? null,
        }),
      );
      return;
    }

    // 授予访问权（真实端点；演示里由提供方/合规调用）
    if (req.method === 'POST' && req.url === '/api/v1/data-access/grants') {
      const required = ['dataProductId', 'granteeParticipantId'];
      const missing = required.filter((key) => !parsed?.[key]);
      if (missing.length > 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: `缺少字段：${missing.join(', ')}` }));
        return;
      }
      const id = `grant-e2e-${state.grants.length + 1}`;
      const row = {
        id,
        dataProductId: parsed.dataProductId,
        providerId: CATALOG.items.find((item) => item.id === parsed.dataProductId)?.providerId ?? null,
        granteeParticipantId: parsed.granteeParticipantId,
        permissions: parsed.permissions ?? ['compute'],
        status: 'active',
        grantedAt: new Date().toISOString(),
        expiresAt: parsed.expiresAt ?? null,
      };
      state.grants.push(row);
      res.end(JSON.stringify(row));
      return;
    }

    // 回收访问权（追加式：行保留、状态转 revoked、原因留痕）
    const revokeGrant = req.url.match(/^\/api\/v1\/data-access\/grants\/([^/]+)\/revoke$/);
    if (req.method === 'POST' && revokeGrant) {
      const row = state.grants.find((g) => g.id === revokeGrant[1]);
      if (!row) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: `访问授权 ${revokeGrant[1]} 不存在` }));
        return;
      }
      Object.assign(row, {
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokeReason: parsed?.reason ?? '未说明',
      });
      res.end(JSON.stringify(row));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/v1/mdop/jobs/external-control') {
      // 让「错误恢复」用例可控地失败：分层键里出现 FAIL 即拒。
      const strata = Array.isArray(parsed?.strataKeys) ? parsed.strataKeys.join(',') : '';
      if (strata.includes('FAIL')) {
        res.statusCode = 422;
        res.end(JSON.stringify({ message: 'control-plane rejected: strataKeys 不受支持' }));
        return;
      }
      // 控制面也会校验合约：桩同样校验（避免"桩放行、真控制面拒绝"的假绿灯）
      const given = Array.isArray(parsed?.contracts) ? parsed.contracts : [];
      const usable = usableContractIds();
      if (!given.some((id) => usable.includes(id))) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            statusCode: 400,
            code: 'E_CONTRACT_MISSING',
            message: '外部对照至少需要一份合约',
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          jobId: 'job-e2e-1',
          status: 'submitted',
          template: 'rws.external-control',
          stages: 6,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'not found: ' + req.method + ' ' + req.url }));
  });
});

server.listen(5099, () => console.log('control-plane stub on 5099'));
