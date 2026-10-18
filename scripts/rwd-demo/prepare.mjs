#!/usr/bin/env node
/**
 * RWD 单臂外部对照演示 —— 准备与体检脚本。
 *
 * 它只做**可重复、幂等**的准备动作，并在每一步打印真实结果：
 *   1. 用研究机构账号登录，列出本空间可见的数据产品与合约（含是否已签名/是否可用）；
 *   2. 检查两个产品级 ACL 是否已授给研究机构（D-ACL-1，fail-closed）；
 *   3. 若未授权：用两家医院账号分别授予 compute（重复执行是更新，不会产生重复行）；
 *   4. 再以研究机构身份复核 ACL 判定。
 *
 * 不替任何人签合约：合约生效必须由持有方连接器签名（D-MDOP-4）——本脚本只把
 * 「访问授权」这一层准备好，合约那一层按 RWD-SINGLE-ARM-TEST.md 的步骤走。
 *
 * 用法（仓库根目录）：
 *   node scripts/rwd-demo/prepare.mjs              # 真执行（会授予 ACL）
 *   node scripts/rwd-demo/prepare.mjs --dry-run    # 只体检，不写任何数据
 *   BASE=http://localhost:5021/api/v1 node scripts/rwd-demo/prepare.mjs
 *
 * 账号是仓库登录页上的演示账号（密码 demo123456），可用环境变量覆盖：
 *   RESEARCH_ACCOUNT / HOSPITAL_A_ACCOUNT / HOSPITAL_B_ACCOUNT / DEMO_PASSWORD
 */
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const BASE = (process.env.BASE ?? 'http://localhost:5021/api/v1').replace(/\/+$/, '');

const ACCOUNTS = {
  research: {
    account: process.env.RESEARCH_ACCOUNT ?? 'research@meddata-inst.edu.cn',
    password: process.env.DEMO_PASSWORD ?? 'demo123456',
    label: '医科大数据研究院（使用方）',
  },
  hospitalA: {
    account: process.env.HOSPITAL_A_ACCOUNT ?? 'admin@demohospa-hospital.com',
    password: process.env.DEMO_PASSWORD ?? 'demo123456',
    label: '示范甲医院（提供方）',
  },
  hospitalB: {
    account: process.env.HOSPITAL_B_ACCOUNT ?? 'admin@rjh.com.cn',
    password: process.env.DEMO_PASSWORD ?? 'demo123456',
    label: '示范乙医院（提供方）',
  },
};

/** 演示用的两个产品：胰岛素暴露队列（胰腺炎信号注入），两家医院各一份。 */
const PRODUCTS = [
  { id: 'dp-insulin-panc-demohospa', providerId: 'p-demohospa' },
  { id: 'dp-insulin-panc-demohospb', providerId: 'p-demohospb' },
];
const CONSUMER_PARTICIPANT = 'p-meddata';

/**
 * 合规预审（D-CMP-2）的最小可过配置。
 *
 * 只填 scenarioKey 会判 block（高风险缺匿名化/安全能力声明）。这组值是实测能出
 * **auto_approve** 的：中风险场景 + 已落地的 federated 保障级协议 + 部分匿名化 + k≥5。
 * （`manual_review` 也能用，但医院签发时要额外填确认理由。）
 */
const PREREVIEW_CONFIG = {
  scenarioKey: 'multi-center-clinical-research',
  protocolKeys: ['federated-local-compute'],
  chosenParams: { anonymizationKey: 'partial', kAnonymity: 5 },
  riskDimensions: { participantCount: 2 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, init = {}, token) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${body?.message ?? text.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * 验证码是 SVG（验证码字符以 `<text>` 文本节点出现）。
 * 演示脚本直接读字形文本，省掉人工识别；这不是绕过安全机制——验证码本来就是给
 * 「能读到 SVG 的客户端」看的，演示机器人读同一份图。
 */
async function login({ account, password }) {
  const cap = await request('/auth/captcha');
  const b64 = cap.image.includes(',') ? cap.image.slice(cap.image.indexOf(',') + 1) : cap.image;
  const svg = Buffer.from(b64, 'base64').toString('utf8');
  const code = [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((m) => m[1])
    .filter((s) => s.trim())
    .join('');
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password, captchaId: cap.captchaId, captchaCode: code }),
  });
  return { token: res.access_token, user: res.user ?? {} };
}

/** 登录（带 429 重试：演示环境按 IP 限流，连续跑脚本容易被挡）。 */
async function loginWithRetry(who, attempts = 4) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await login(who);
    } catch (e) {
      if (e.status === 429 && i < attempts - 1) {
        console.log(`  … 登录限流，等待 20s 后重试（${i + 1}/${attempts}）`);
        await sleep(20_000);
        continue;
      }
      throw e;
    }
  }
}

const fmt = (v) => String(v ?? '—');

async function main() {
  console.log(`\n== RWD 单臂外部对照 · 演示准备 ${DRY ? '(dry-run：不写数据)' : ''}`);
  console.log(`   API: ${BASE}\n`);

  // 1) 使用方：产品 / 合约 / ACL 现状
  const research = await loginWithRetry(ACCOUNTS.research);
  console.log(`1. 登录 ${ACCOUNTS.research.label}：${research.user.name}（${research.user.participantId}）`);

  const products = await request('/catalog', {}, research.token);
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const wanted of PRODUCTS) {
    const p = byId.get(wanted.id);
    console.log(`   · 产品 ${wanted.id}: ${p ? `${p.title}（provider=${p.providerId}）` : '目录中不可见'}`);
  }

  const contracts = await request('/contracts', {}, research.token);
  console.log(`\n2. 可见合约 ${contracts.length} 份：`);
  for (const c of contracts) {
    const signed = Boolean(c.holderSignature);
    const usable = signed && c.mdopStatus === 'active';
    console.log(
      `   · ${String(c.id).slice(0, 16).padEnd(16)} ${fmt(c.dataProductId).slice(0, 34).padEnd(34)}` +
        ` ${fmt(c.providerId)}→${fmt(c.consumerId)}  status=${fmt(c.status)}  mdop=${fmt(c.mdopStatus)}` +
        `  签名=${signed ? '是' : '否'}  ${usable ? '✅可用' : '⛔不可用于作业'}`,
    );
  }
  console.log('   （提示：签名=否 的合约只能看不能用——MDOP 作业要求持有方签名 + mdopStatus=active）');

  console.log('\n3. 产品级 ACL 判定（以研究机构身份问）：');
  const before = [];
  for (const p of PRODUCTS) {
    const verdict = await request(
      `/data-access/check?dataProductId=${encodeURIComponent(p.id)}&permission=compute`,
      {},
      research.token,
    );
    before.push(verdict);
    console.log(`   · ${p.id}: allowed=${verdict.allowed} reason=${verdict.reason}`);
  }

  // 2) 未授权 → 医院授予（幂等：重复执行是更新）
  const missing = PRODUCTS.filter((p) => before.find((v) => v.dataProductId === p.id)?.allowed !== true);
  if (missing.length === 0) {
    console.log('\n4. ACL 已就绪，无需授予。');
  } else if (DRY) {
    console.log(`\n4. dry-run：${missing.length} 个产品缺授权，未写入。`);
  } else {
    console.log(`\n4. 由提供方授予 ACL（缺 ${missing.length} 个）：`);
    const providers = {
      'p-demohospa': ACCOUNTS.hospitalA,
      'p-demohospb': ACCOUNTS.hospitalB,
    };
    for (const p of missing) {
      const who = providers[p.providerId];
      const hosp = await loginWithRetry(who);
      const granted = await request(
        '/data-access/grants',
        {
          method: 'POST',
          body: JSON.stringify({
            dataProductId: p.id,
            granteeParticipantId: CONSUMER_PARTICIPANT,
            permissions: ['compute'],
            note: 'RWD 单臂外部对照演示',
          }),
        },
        hosp.token,
      );
      console.log(`   · ${who.label} 授予 ${p.id} → ${CONSUMER_PARTICIPANT}（grant ${String(granted.id).slice(0, 8)}，${granted.status}）`);
    }
  }

  // 3) 复核
  console.log('\n5. 复核 ACL：');
  for (const p of PRODUCTS) {
    const verdict = await request(
      `/data-access/check?dataProductId=${encodeURIComponent(p.id)}&permission=compute`,
      {},
      research.token,
    );
    console.log(`   · ${p.id}: allowed=${verdict.allowed} reason=${verdict.reason} ${verdict.grantId ? `grant=${String(verdict.grantId).slice(0, 8)}` : ''}`);
  }

  // 4) 合规预审（合约申请的前置，D-CMP-2）
  console.log('\n6. 合规预审（合约申请必须引用一份本方且非 block 的预审）：');
  try {
    const scenarios = await request('/capability/l1_scenario', {}, research.token);
    if (Array.isArray(scenarios) && scenarios.length === 0) {
      console.log('   ⚠ 能力注册表为空：先跑 `DATABASE_URL=<与 API 同库> pnpm --filter @medtrust/database seed`');
    }
    const list = await request('/compositions', {}, research.token);
    const usable = list.find(
      (c) => c.scenarioKey === PREREVIEW_CONFIG.scenarioKey && c.verdict === 'auto_approve',
    );
    if (usable) {
      console.log(`   · 已有 auto_approve 预审：${usable.id}（${usable.scenarioKey}）`);
    } else if (DRY) {
      console.log('   · dry-run：没有 auto_approve 预审，未创建。');
    } else {
      const comp = await request(
        '/composition',
        { method: 'POST', body: JSON.stringify(PREREVIEW_CONFIG) },
        research.token,
      );
      const ev = await request(
        `/compliance/evaluate/${comp.id}`,
        { method: 'POST', body: '{}' },
        research.token,
      );
      console.log(
        `   · 已创建预审 ${comp.id} → 裁决 ${ev.autoVerdict}（风险 ${ev.overallRisk}）`,
      );
    }
  } catch (e) {
    console.log(`   ⚠ 预审检查/创建失败：${e.message}`);
  }

  console.log('\n下一步（详见 RWD-SINGLE-ARM-TEST.md）：');
  console.log('  · 合约是否可用于作业：看上面「签名=是 且 mdop=active」；没有就按文档走「申请 → 医院签发 → 连接器签名」。');
  console.log('  · 然后在 http://localhost:5020/space/chat 让 AI 助手做「单臂试验外部对照」。');
}

main().catch((e) => {
  console.error(`\n[失败] ${e.message}`);
  process.exit(1);
});
