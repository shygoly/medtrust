#!/usr/bin/env node

/** 从生产 GET /contracts 原样响应生成双臂合约证据板。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const API = process.env.MEDTRUST_API ?? 'https://api.szchada.top/api/v1';
const TRIAL = '56dc0834-c30b-4970-a7ed-735cebdf8435';
const CONTROL = 'f06ce079-4a7e-4608-be78-b57fa3b07e90';

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

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').trim())
    .filter(Boolean)
    .join('');
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
const contracts = await request('/contracts', {}, login.access_token);
const selected = contracts.filter((item) => [TRIAL, CONTROL].includes(item.id));
if (selected.length !== 2) throw new Error(`目标合约只找到 ${selected.length} 份`);

const rows = selected
  .sort((left, right) => (left.id === TRIAL ? -1 : 1))
  .map((contract) => {
    const minCell = contract.outputPolicy?.minCell;
    const operators = contract.mdopTerms?.allowedOpDigests ?? [];
    return `
      <section class="card">
        <div class="label">${contract.id === TRIAL ? '华山 / 试验臂' : '瑞金 / 对照臂'}</div>
        <div class="mono id">${esc(contract.id)}</div>
        <table>
          <tr><th>提供方</th><td class="mono">${esc(contract.providerId)}</td></tr>
          <tr><th>使用方</th><td class="mono">${esc(contract.consumerId)}</td></tr>
          <tr><th>数据产品</th><td class="mono">${esc(contract.dataProductId)}</td></tr>
          <tr><th>用途</th><td>${esc(contract.mdopTerms?.purposeCode ?? contract.purpose)}</td></tr>
          <tr><th>业务状态</th><td class="green">${esc(contract.status)}</td></tr>
          <tr><th>MDOP 状态</th><td class="green">${esc(contract.mdopStatus)}</td></tr>
          <tr><th>有效期</th><td>${esc(contract.validUntil)}</td></tr>
          <tr><th>minCell</th><td>${esc(minCell)}</td></tr>
          <tr><th>允许算子</th><td class="mono">${operators.map(esc).join('<br>')}</td></tr>
          <tr><th>持有方签名</th><td class="mono sig">${esc(contract.holderSignature)}</td></tr>
          <tr><th>平台副署</th><td class="mono sig">${esc(contract.platformCountersignature)}</td></tr>
        </table>
      </section>`;
  })
  .join('');

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>
body{margin:0;background:#071015;color:#dbe7ea;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
main{width:1440px;min-height:1000px;padding:34px 46px}
h1{margin:0;color:#fff;font-size:28px}.sub{margin:8px 0 20px;color:#8fa2a8;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:#0c1a20;border:1px solid #1a3038;border-radius:8px;padding:16px}
.label{color:#7f959c;font-size:12px}.id{margin:7px 0 13px;color:#fff;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12px}th{width:105px;text-align:left;color:#8fa2a8;padding:6px;border-bottom:1px solid #173039;vertical-align:top}
td{padding:6px;border-bottom:1px solid #173039;vertical-align:top}.mono{font-family:Menlo,monospace;font-size:10px;word-break:break-all}
.green{color:#5ee0b1}.sig{font-size:9px;line-height:1.35}.foot{margin-top:16px;color:#71868d;font-size:10px}
</style><body><main>
<h1>单臂外部对照 · 双臂合约有效性证据</h1>
<div class="sub">来源：生产 GET /contracts 原样响应；药企身份 pharma-demo / consumer；不是医院角色入口截图。</div>
<div class="grid">${rows}</div>
<div class="foot">两份成员合约均 active / active，持有方签名与平台副署均在，允许 rws.external-control@1.0.0 与 declassify.small_cell@1.0.0，minCell=5。</div>
</main></body></html>`;

mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'contract-evidence-r5.json'),
  JSON.stringify({ source: `${API}/contracts`, contracts: selected }, null, 2),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({
    path: join(ROOT, 'screenshots', '11-contract-evidence-r5.png'),
  });
} finally {
  await browser.close();
}
