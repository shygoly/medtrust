#!/usr/bin/env node

/** 续读已由统一助手提交的作业，直到销毁回执收齐或失败。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILE = join(ROOT, 'data', 'ai-preflight-r5.json');
const evidence = JSON.parse(readFileSync(FILE, 'utf8'));
const API = evidence.api;
const jobId = evidence.jobId;

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join('');
}

async function request(path, init = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${body.message ?? text}`);
  return body;
}

const captcha = await request('/auth/captcha');
const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    account: evidence.account,
    password: 'demo123456',
    captchaId: captcha.captchaId,
    captchaCode: captchaCode(captcha.image),
  }),
});

for (let attempt = 0; attempt < 60; attempt += 1) {
  const detail = await request(`/mdop/jobs/${encodeURIComponent(jobId)}`, {}, login.access_token);
  const job = detail.job ?? detail;
  evidence.timeline.push({
    at: new Date().toISOString(),
    status: job.status,
    planHash: job.planHash,
    contractBundleId: job.contractBundleId,
    contractBundleVersion: job.contractBundleVersion,
    contracts: job.contracts,
    contractBindings: job.contractBindings,
    rejectReason: job.rejectReason,
  });
  evidence.terminal = detail;
  writeFileSync(FILE, JSON.stringify(evidence, null, 2));
  console.log(`${new Date().toISOString()} ${jobId} ${job.status}`);
  if (['PURGED', 'FAILED', 'REJECTED', 'ABORTED'].includes(job.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
