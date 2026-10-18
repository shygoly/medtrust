#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(ROOT, 'data', `run-${process.env.RUN_TAG ?? 'attempt'}.json`);
const BASE = (process.env.MEDTRUST_BASE ?? 'http://127.0.0.1:5080/api/v1').replace(/\/+$/, '');
const ACCOUNT = process.env.MEDTRUST_ACCOUNT ?? 'pv@demo-pharma.example';
const PASSWORD = process.env.MEDTRUST_PASSWORD ?? 'demo123456';

const TRIAL_PRODUCT = '40ff788a-89e7-4601-9981-9b9b962d509e';
const CONTROL_PRODUCT = '99bd8b08-6a69-457f-8063-2bde919ea413';
const TRIAL_PARTICIPANT = 'p-huashan';
const CONTROL_PARTICIPANT = 'p-ruijin';
const TEE_NODE = 'urn:tds:sh-med:participant:tee-node-a';
const STRATA_KEYS = ['18-39|M', '18-39|F', '40-64|M', '40-64|F'];
const PREFERRED_TRIAL_CONTRACT = '56dc0834-c30b-4970-a7ed-735cebdf8435';
const PREFERRED_CONTROL_CONTRACT = 'f06ce079-4a7e-4608-be78-b57fa3b07e90';

mkdirSync(join(ROOT, 'data'), { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, init = {}, token) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${BASE}${path}`, {
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
    if (response.ok) return { status: response.status, body };
    if (response.status === 429 && attempt < 4) {
      await sleep(20_000);
      continue;
    }
    const error = new Error(
      `${response.status} ${body.message ?? body.error ?? text.slice(0, 300)}`,
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  throw new Error('request retries exhausted');
}

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) =>
      match[1]
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .trim(),
    )
    .filter(Boolean)
    .join('');
}

async function login() {
  const captcha = (
    await request('/auth/captcha')
  ).body;
  const loginResult = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      account: ACCOUNT,
      password: PASSWORD,
      captchaId: captcha.captchaId,
      captchaCode: captchaCode(captcha.image),
    }),
  });
  return loginResult.body;
}

function selectContract(contracts, dataProductId, preferredId) {
  const now = Date.now();
  const candidates = contracts
    .filter(
      (contract) =>
        contract.dataProductId === dataProductId &&
        contract.consumerId === 'pharma-demo' &&
        contract.providerId ===
          (dataProductId === TRIAL_PRODUCT ? TRIAL_PARTICIPANT : CONTROL_PARTICIPANT) &&
        contract.status === 'active' &&
        contract.mdopStatus === 'active' &&
        contract.holderSignature &&
        (!contract.validUntil || Date.parse(contract.validUntil) > now),
    );
  const preferred = candidates.find((contract) => contract.id === preferredId);
  if (preferred) return preferred;
  return candidates
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .at(0);
}

function slimJob(job) {
  return {
    id: job.id,
    status: job.status,
    planHash: job.planHash,
    rejectReason: job.rejectReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    fragments: job.fragments,
    tickets: job.tickets,
    stages: job.stages,
    result: job.result,
    releaseManifest: job.releaseManifest,
    anchors: job.anchors,
    purgeReceipt: job.purgeReceipt,
  };
}

const session = await login();
const token = session.access_token;
const [profileResult, catalogResult, contractsResult] = await Promise.all([
  request('/auth/profile', {}, token),
  request('/catalog', {}, token),
  request('/contracts', {}, token),
]);
const profile = profileResult.body;
const catalog = catalogResult.body;
const contracts = contractsResult.body;
const trialContract = selectContract(
  contracts,
  TRIAL_PRODUCT,
  PREFERRED_TRIAL_CONTRACT,
);
const controlContract = selectContract(
  contracts,
  CONTROL_PRODUCT,
  PREFERRED_CONTROL_CONTRACT,
);

if (!trialContract || !controlContract) {
  throw new Error('没有找到两份可用的 drug-registration 双签合约');
}

const trialProduct = catalog.find((product) => product.id === TRIAL_PRODUCT);
const controlProduct = catalog.find((product) => product.id === CONTROL_PRODUCT);
if (!trialProduct || !controlProduct) {
  throw new Error('目录中找不到试验组或对照组产品');
}

const now = Date.now();
const startedAt = new Date(now).toISOString();
const contractsEndAt = Math.min(
  Date.parse(trialContract.validUntil),
  Date.parse(controlContract.validUntil),
);
const notAfter = new Date(contractsEndAt - 5 * 60_000).toISOString();
if (Date.parse(notAfter) <= now) {
  throw new Error('两份合约的共同有效期不足以容纳本轮作业窗口');
}
const payload = {
  purpose: trialContract.purpose,
  applicant: { org: 'pharma-demo', project: 'single-arm-external-control-r4' },
  contracts: [trialContract.id, controlContract.id],
  contractsByParticipant: {
    [TRIAL_PARTICIPANT]: trialContract.id,
    [CONTROL_PARTICIPANT]: controlContract.id,
  },
  trial: { participantId: TRIAL_PARTICIPANT, dataProductId: TRIAL_PRODUCT },
  controls: { participantId: CONTROL_PARTICIPANT, dataProductId: CONTROL_PRODUCT },
  teeNode: TEE_NODE,
  strataKeys: STRATA_KEYS,
  caliperDays: 30,
  ratioK: 2,
  minCell: 5,
  notBefore: startedAt,
  notAfter,
};

const submission = await request('/mdop/jobs/external-control', {
  method: 'POST',
  body: JSON.stringify(payload),
}, token);
const jobId = submission.body.jobId;
const timeline = [];
let compiled;

async function snapshot(label) {
  const { body } = await request(`/mdop/jobs/${encodeURIComponent(jobId)}`, {}, token);
  const entry = {
    label,
    at: new Date().toISOString(),
    job: slimJob(body.job ?? body),
  };
  timeline.push(entry);
  writeFileSync(
    OUTPUT,
    JSON.stringify({
      base: BASE,
      account: ACCOUNT,
      profile,
      trialProduct,
      controlProduct,
      trialContract,
      controlContract,
      payload,
      submission: submission.body,
      compile: compiled?.body ?? null,
      jobId,
      timeline,
    }, null, 2),
  );
  return entry;
}

await snapshot('submitted');
compiled = await request(`/mdop/jobs/${encodeURIComponent(jobId)}/compile`, {
  method: 'POST',
  body: JSON.stringify({}),
}, token);
await snapshot('compiled');

let finalEntry;
const terminal = new Set(['SUCCEEDED', 'REJECTED', 'FAILED', 'CANCELLED', 'PURGED']);
for (let round = 0; round < 180; round += 1) {
  await sleep(2_000);
  const entry = await snapshot(`poll-${round + 1}`);
  finalEntry = entry;
  if (terminal.has(entry.job.status)) break;
}

console.log(JSON.stringify({
  jobId,
  submission: submission.body,
  compile: compiled.body,
  contractIds: [trialContract.id, controlContract.id],
  finalStatus: finalEntry?.job.status,
  finalAt: finalEntry?.at,
  output: OUTPUT,
}, null, 2));

if (finalEntry?.job.status !== 'PURGED') {
  process.exitCode = 2;
}
