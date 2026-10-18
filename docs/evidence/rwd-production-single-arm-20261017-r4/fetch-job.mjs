#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:5080/api/v1';
const JOB = process.argv[2];
if (!JOB) throw new Error('usage: node fetch-job.mjs <job-id>');

async function request(path, init = {}, token) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${body.message ?? text}`);
  return body;
}

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join('');
}

const captcha = await request('/auth/captcha');
const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    account: 'pv@demo-pharma.example',
    password: 'demo123456',
    captchaId: captcha.captchaId,
    captchaCode: captchaCode(captcha.image),
  }),
});
const token = login.access_token;
const job = await request(`/mdop/jobs/${encodeURIComponent(JOB)}`, {}, token);
console.log(JSON.stringify(job, null, 2));
