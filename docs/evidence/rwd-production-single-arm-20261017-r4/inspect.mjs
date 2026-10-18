#!/usr/bin/env node

const BASE = (process.env.MEDTRUST_BASE ?? 'http://127.0.0.1:5080/api/v1').replace(/\/+$/, '');
const ACCOUNT = process.env.MEDTRUST_ACCOUNT ?? 'pv@demo-pharma.example';
const PASSWORD = process.env.MEDTRUST_PASSWORD ?? 'demo123456';

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
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const error = new Error(`${response.status} ${body.message ?? text.slice(0, 200)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].replaceAll('&amp;', '&').trim())
    .filter(Boolean)
    .join('');
}

async function login(account, password) {
  const captcha = await request('/auth/captcha');
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      account,
      password,
      captchaId: captcha.captchaId,
      captchaCode: captchaCode(captcha.image),
    }),
  });
  return result.access_token;
}

const token = await login(ACCOUNT, PASSWORD);
const [profile, products, contracts, jobs, notifications] = await Promise.all([
  request('/auth/profile', {}, token),
  request('/catalog', {}, token),
  request('/contracts', {}, token),
  request('/mdop/jobs', {}, token),
  request('/notifications', {}, token),
]);

const wantedProducts = new Set([
  '40ff788a-89e7-4601-9981-9b9b962d509e',
  '99bd8b08-6a69-457f-8063-2bde919ea413',
]);
const selectedProducts = products.filter((product) => wantedProducts.has(product.id));
const selectedContracts = contracts.filter((contract) => wantedProducts.has(contract.dataProductId));

console.log(JSON.stringify({
  base: BASE,
  profile: {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    participantId: profile.participantId,
    spaceId: profile.spaceId,
  },
  products: selectedProducts.map((product) => ({
    id: product.id,
    title: product.title,
    providerId: product.providerId,
    rowCount: product.rowCount,
    classification: product.classification,
  })),
  contracts: selectedContracts.map((contract) => ({
    id: contract.id,
    dataProductId: contract.dataProductId,
    providerId: contract.providerId,
    consumerId: contract.consumerId,
    status: contract.status,
    mdopStatus: contract.mdopStatus,
    purpose: contract.purpose,
    validUntil: contract.validUntil,
    holderSignature: Boolean(contract.holderSignature),
    platformCountersignature: Boolean(contract.platformCountersignature),
    mdopTerms: contract.mdopTerms ?? null,
  })),
  jobs: jobs.slice(0, 8).map((job) => ({
    id: job.id,
    status: job.status,
    template: job.template,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  })),
  notifications: notifications.slice(0, 8).map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  })),
}, null, 2));
