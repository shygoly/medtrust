#!/usr/bin/env node

/**
 * 2026-10-17 生产复测：药企从自然语言进入统一助手，经确定性参数卡、
 * 双成员合约预检和 bundle 提交执行。只使用元数据字段，不读取任何患者行。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = (process.env.MEDTRUST_API ?? 'https://api.szchada.top/api/v1').replace(/\/+$/, '');
const CHAT = (
  process.env.MEDTRUST_CHAT ?? 'https://api.szchada.top/chat-agent/api/v1'
).replace(/\/+$/, '');
const ACCOUNT = process.env.MEDTRUST_ACCOUNT ?? 'pv@demo-pharma.example';
const PASSWORD = process.env.MEDTRUST_PASSWORD ?? 'demo123456';
const OUTPUT = join(ROOT, 'data', 'ai-preflight-r5.json');
const TRIAL_PRODUCT = '40ff788a-89e7-4601-9981-9b9b962d509e';
const CONTROL_PRODUCT = '99bd8b08-6a69-457f-8063-2bde919ea413';
const STRATA = ['18-39|M', '18-39|F', '40-64|M', '40-64|F'];

mkdirSync(join(ROOT, 'data'), { recursive: true });

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').trim())
    .filter(Boolean)
    .join('');
}

async function request(url, init = {}, token) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok)
    throw new Error(`${response.status} ${body.message ?? body.error ?? text.slice(0, 300)}`);
  return body;
}

function valueOf(card, fieldName) {
  return card.fields?.find((field) => field.name === fieldName)?.options?.[0]?.value;
}

const captcha = await request(`${API}/auth/captcha`);
const login = await request(`${API}/auth/login`, {
  method: 'POST',
  body: JSON.stringify({
    account: ACCOUNT,
    password: PASSWORD,
    captchaId: captcha.captchaId,
    captchaCode: captchaCode(captcha.image),
  }),
});
const token = login.access_token;
const profile = await request(`${API}/auth/profile`, {}, token);
const headers = {
  'x-user-id': String(profile.userId),
  'x-space-id': profile.spaceId ?? 'sh-med',
  'x-user-role': profile.role,
  authorization: `Bearer ${token}`,
};

const first = await request(`${CHAT}/chat`, {
  method: 'POST',
  body: JSON.stringify({
    message: '我想做单臂试验的外部对照，用于药物注册申请',
    page: '/space/assistant',
  }),
  headers,
});
const form = first.cards?.find((card) => card.type === 'form');
if (!form) throw new Error(`首轮没有返回参数卡：${JSON.stringify(first.cards)}`);

const trial = valueOf(form, 'trial');
const trialDataProduct = valueOf(form, 'trialDataProduct');
const controls = valueOf(form, 'controls');
const controlsDataProduct = valueOf(form, 'controlsDataProduct');
if (
  trialDataProduct !== TRIAL_PRODUCT ||
  controlsDataProduct !== CONTROL_PRODUCT ||
  trial !== 'p-huashan' ||
  controls !== 'p-ruijin'
) {
  throw new Error(
    `参数卡绑定了错误对象：${JSON.stringify({ trial, trialDataProduct, controls, controlsDataProduct })}`,
  );
}

const values = {
  trial,
  trialDataProduct,
  controls,
  controlsDataProduct,
  teeNode:
    form.fields?.find((field) => field.name === 'teeNode')?.defaultValue ??
    'urn:tds:sh-med:participant:tee-node-a',
  strataKeys: STRATA.join(', '),
  caliperDays: 30,
  ratioK: 2,
};
const submission = await request(`${CHAT}/chat`, {
  method: 'POST',
  body: JSON.stringify({
    sessionId: first.sessionId,
    message: `[card:submit] ${JSON.stringify({
      kind: 'card-submit',
      cardType: 'form',
      title: form.title,
      scenario: form.scenario,
      values,
    })}`,
    page: '/space/assistant',
  }),
  headers,
});
const status = submission.cards?.find(
  (card) => card.type === 'status' && card.data?.jobId,
);
if (!status?.data?.jobId)
  throw new Error(`提交未生成作业：${JSON.stringify(submission.cards)}`);

const jobId = String(status.data.jobId);
const compile = await request(`${API}/mdop/jobs/${encodeURIComponent(jobId)}/compile`, {
  method: 'POST',
  body: JSON.stringify({}),
}, token);
const timeline = [];
let terminal;
for (let attempt = 0; attempt < 48; attempt += 1) {
  const detail = await request(`${API}/mdop/jobs/${encodeURIComponent(jobId)}`, {}, token);
  const job = detail.job ?? detail;
  const snapshot = {
    at: new Date().toISOString(),
    status: job.status,
    planHash: job.planHash,
    contractBundleId: job.contractBundleId,
    contractBundleVersion: job.contractBundleVersion,
    contracts: job.contracts,
    contractBindings: job.contractBindings,
    rejectReason: job.rejectReason,
  };
  timeline.push(snapshot);
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        api: API,
        chat: CHAT,
        account: ACCOUNT,
        profile,
        first: {
          sessionId: first.sessionId,
          assistantIntent: first.assistantIntent,
          draft: first.draft,
          text: first.message?.content,
          card: form,
        },
        submission: {
          sessionId: submission.sessionId,
          assistantIntent: submission.assistantIntent,
          draft: submission.draft,
          values,
          cards: submission.cards,
        },
        jobId,
        compile,
        timeline,
        detail,
      },
      null,
      2,
    ),
  );
  console.log(`${new Date().toISOString()} ${jobId} ${job.status}`);
  if (['PURGED', 'FAILED', 'REJECTED', 'ABORTED'].includes(job.status)) {
    terminal = detail;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      api: API,
      chat: CHAT,
      account: ACCOUNT,
      profile,
      first: {
        sessionId: first.sessionId,
        assistantIntent: first.assistantIntent,
        draft: first.draft,
        text: first.message?.content,
        card: form,
      },
      submission: {
        sessionId: submission.sessionId,
        assistantIntent: submission.assistantIntent,
        draft: submission.draft,
        values,
        cards: submission.cards,
      },
      jobId,
      compile,
      timeline,
      terminal,
    },
    null,
    2,
  ),
);
console.log(`saved ${OUTPUT}`);
