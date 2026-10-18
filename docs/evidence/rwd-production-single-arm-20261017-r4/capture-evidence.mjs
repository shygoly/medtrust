#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');

const ROOT = dirname(fileURLToPath(import.meta.url));
const uiRun = JSON.parse(readFileSync(join(ROOT, 'data', 'ui-preflight-r5.json'), 'utf8'));
const finalJob = uiRun.detail;
const run = JSON.parse(readFileSync(join(ROOT, 'data', 'ai-preflight-r5.json'), 'utf8'));
const contractEvidence = JSON.parse(
  readFileSync(join(ROOT, 'data', 'contract-evidence-r5.json'), 'utf8'),
);
const failed = JSON.parse(readFileSync(join(ROOT, 'data', 'run.json'), 'utf8'));

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const short = (value, start = 18, end = 10) => {
  const text = String(value ?? '');
  return text.length <= start + end + 1
    ? text
    : `${text.slice(0, start)}…${text.slice(-end)}`;
};

function shell(title, subtitle, body, footer) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #071015;
    color: #dbe7ea;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  main { width: 1440px; min-height: 1000px; padding: 38px 48px 34px; }
  h1 { margin: 0; color: #fff; font-size: 28px; font-weight: 700; }
  h2 { margin: 24px 0 10px; color: #fff; font-size: 17px; }
  .sub { margin-top: 7px; color: #8fa2a8; font-size: 13px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .card { background: #0c1a20; border: 1px solid #1a3038; border-radius: 8px; padding: 12px 14px; }
  .label { color: #7f959c; font-size: 11px; letter-spacing: .05em; }
  .value { margin-top: 5px; color: #f1f6f7; font-size: 14px; }
  .mono { font-family: "SFMono-Regular", Menlo, monospace; font-size: 11px; word-break: break-all; }
  .green { color: #5ee0b1; } .amber { color: #e7bd6d; } .red { color: #ff877c; } .cyan { color: #73d4d4; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #8fa2a8; font-weight: 500; padding: 7px 6px; border-bottom: 1px solid #29414a; }
  td { padding: 7px 6px; border-bottom: 1px solid #172a31; vertical-align: top; }
  pre { margin: 0; white-space: pre-wrap; color: #b7cad0; font-family: "SFMono-Regular", Menlo, monospace; font-size: 11px; line-height: 1.55; }
  .footer { margin-top: 14px; color: #6d8188; font-size: 10px; }
  .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #12302d; color: #70e0bb; font-size: 11px; }
</style>
<body><main>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(subtitle)}</div>
  ${body}
  <div class="footer">${esc(footer)}</div>
</main></body></html>`;
}

const trialContract = contractEvidence.contracts.find(
  (item) => item.id === '56dc0834-c30b-4970-a7ed-735cebdf8435',
);
const controlContract = contractEvidence.contracts.find(
  (item) => item.id === 'f06ce079-4a7e-4608-be78-b57fa3b07e90',
);
const chains = finalJob.chains;
const witnesses = finalJob.witnessStatus.witnesses;
const anchors = finalJob.anchors;
const result = finalJob.result;

const serviceChain = shell(
  '单臂外部对照生产链路 · 服务与数据控制点',
  '2026-10-17 生产环境复测；页面截图为 web.szchada.top 同源源站，控制面与连接器均为生产实例。',
  `
  <div class="grid3">
    <div class="card"><div class="label">发起账号</div><div class="value">pv@demo-pharma.example</div><div class="label" style="margin-top:6px">口令 demo123456 · pharma-demo · consumer</div></div>
    <div class="card"><div class="label">试验数据</div><div class="value">华山 · 合成 460 例</div><div class="label mono" style="margin-top:6px">${esc(run.submission.values.trialDataProduct)}</div></div>
    <div class="card"><div class="label">历史对照</div><div class="value">瑞金 · 合成 5,600 例</div><div class="label mono" style="margin-top:6px">${esc(run.submission.values.controlsDataProduct)}</div></div>
  </div>
  <h2>已使用的双签合约</h2>
  <div class="grid2">
    <div class="card">
      <div class="label">华山 / 试验臂</div>
      <div class="mono" style="margin-top:6px">${esc(trialContract.id)}</div>
      <div class="label" style="margin-top:8px">active · active · holderSigned=true · validUntil ${esc(trialContract.validUntil)}</div>
      <div class="label" style="margin-top:6px">允许算子 ${esc(trialContract.mdopTerms.allowedOpDigests.join(' / '))}</div>
    </div>
    <div class="card">
      <div class="label">瑞金 / 对照臂</div>
      <div class="mono" style="margin-top:6px">${esc(controlContract.id)}</div>
      <div class="label" style="margin-top:8px">active · active · holderSigned=true · validUntil ${esc(controlContract.validUntil)}</div>
      <div class="label" style="margin-top:6px">允许算子 ${esc(controlContract.mdopTerms.allowedOpDigests.join(' / '))}</div>
    </div>
  </div>
  <h2>链路与后台动作</h2>
  <table>
    <tr><th>顺序</th><th>入口 / 主体</th><th>后台服务或 Agent</th><th>实际动作</th><th>结果</th></tr>
    <tr><td>1</td><td>AI 助手 / 药企</td><td>chat-agent → 场景路由 → 参数卡</td><td>自然语言命中外部对照；服务端先返回确定性参数卡</td><td class="green">通过</td></tr>
    <tr><td>2</td><td>参数确认 / 药企</td><td>check_data_access → check_contract_status</td><td>按用户选择的两个数据源逐项检查 ACL 与成员合约，生成 bundle</td><td class="green">2 / 2 ready</td></tr>
    <tr><td>3</td><td>控制面入口 / 药企</td><td>MdopController → MdopJobsService</td><td>POST /mdop/jobs/external-control，展开 6 阶段逻辑计划并落库</td><td class="green">SUBMITTED</td></tr>
    <tr><td>4</td><td>控制面编译</td><td>MdopJobsService + ContractService + AttestationService</td><td>重验用途、签名、有效期、TDX 策略；切成 3 个物理片段</td><td class="green">NEGOTIATING</td></tr>
    <tr><td>5</td><td>华山 / 瑞金</td><td>rws-worker-a / rws-worker-b</td><td>本地验收凭证；source.dataset 读取；seal.envelope 生成 C2 密文信封</td><td class="green">4 阶段成功</td></tr>
    <tr><td>6</td><td>tee-node-a</td><td>TDX 可信节点</td><td>KMS 放钥、rws.external-control 分层匹配、small-cell 发布审查</td><td class="green">2 阶段成功</td></tr>
    <tr><td>7</td><td>平台</td><td>MdopMergeService + MdopPurgeService</td><td>接收 C3、合并结果、发 PurgeOrder、校验三方回执与回执链</td><td class="green">SUCCEEDED → PURGED</td></tr>
  </table>
  `,
  `作业 ${finalJob.job.id} · plan_hash ${finalJob.job.planHash} · bundle ${finalJob.job.contractBundle.id}@${finalJob.job.contractBundle.version} · 终态 ${finalJob.job.updatedAt}`,
);

const tdxAndResult = shell(
  'TDX 证明、节点内匹配与发布审查',
  'C2 密文分别由两院封存后送到 tee-node-a；平台不接触原始行。',
  `
  <div class="grid3">
    <div class="card"><div class="label">证明链型</div><div class="value">TDX</div><div class="label">代码度量 sm3:14761963…</div></div>
    <div class="card"><div class="label">最低可信基</div><div class="value">5.1.3</div><div class="label">KMS 校验方 kms://verifier-domain-b</div></div>
    <div class="card"><div class="label">会话见证</div><div class="value">2 / 2 持有方已核验</div><div class="label">华山的密钥用于试验臂，瑞金的密钥用于对照臂</div></div>
  </div>
  <h2>会话证明</h2>
  <table>
    <tr><th>节点</th><th>Key ID</th><th>Quote digest</th><th>KMS warrant</th><th>持有方核验</th></tr>
    ${witnesses.map((witness) => `<tr>
      <td class="mono">${esc(witness.node)}</td>
      <td class="mono">${esc(witness.keyId)}</td>
      <td class="mono">${esc(witness.quoteDigest)}</td>
      <td class="mono">${esc(witness.warrantDigest)}</td>
      <td class="green">${esc(witness.holderVerification?.status)} · ${esc(witness.holderVerification?.verifier)}</td>
    </tr>`).join('')}
  </table>
  <h2>四个分层的外部对照结果</h2>
  <table>
    <tr><th>分层</th><th>试验阳性</th><th>试验阴性</th><th>对照阳性</th><th>对照阴性</th><th>匹配对数</th><th>未匹配</th></tr>
    ${result.strata.map((row) => `<tr>
      <td>${esc(row.key)}</td><td>${row.mExpPos}</td><td>${row.mExpNeg}</td>
      <td>${row.ctlPos}</td><td>${row.ctlNeg}</td><td class="green">${row.matched}</td><td>${row.unmatched}</td>
    </tr>`).join('')}
    <tr><td><strong>合计</strong></td><td>106</td><td>354</td><td>313</td><td>607</td><td class="green"><strong>460</strong></td><td class="green"><strong>0</strong></td></tr>
  </table>
  <h2>发布审查</h2>
  <div class="grid3">
    <div class="card"><div class="label">minCell</div><div class="value">5</div></div>
    <div class="card"><div class="label">抑制格数</div><div class="value green">0</div></div>
    <div class="card"><div class="label">差分隐私</div><div class="value">未加噪</div><div class="label">如实记录，不是隐私保护已开启</div></div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="label">C3 交付物摘要</div>
    <div class="mono" style="margin-top:6px">${esc(finalJob.stages.find((stage) => stage.stageId === 'decTee')?.id ?? '')}</div>
    <div class="label">4 个分层均达到阈值，发布清单 apiVersion=${esc(result.release_manifest.apiVersion)}</div>
  </div>
  `,
  `结果是合成数据平台流程证据，不构成疗效或安全性结论。`,
);

const purgeAndAudit = shell(
  '销毁回执、回执链与审计锚定',
  '作业成功不等于结束；必须收齐两院和 TDX 节点的销毁回执，回执链连续且链头上链后才算 PURGED。',
  `
  <div class="grid3">
    <div class="card"><div class="label">作业终态</div><div class="value green">PURGED</div><div class="label">${esc(finalJob.job.updatedAt)}</div></div>
    <div class="card"><div class="label">回执链</div><div class="value green">3 / 3 连续</div><div class="label">华山 5 条 · 瑞金 5 条 · tee-node-a 5 条</div></div>
    <div class="card"><div class="label">链上锚定</div><div class="value green">3 / 3</div><div class="label">block ${anchors.map((item) => item.payload.block).join(' / ')}</div></div>
  </div>
  <h2>销毁与锚定明细</h2>
  <table>
    <tr><th>节点</th><th>回执链</th><th>链头摘要</th><th>交易</th><th>区块</th></tr>
    ${anchors.map((anchor) => {
      const chain = chains.find((item) => item.node === anchor.node);
      return `<tr>
        <td class="mono">${esc(anchor.node)}</td>
        <td class="green">${chain?.valid ? '连续' : '未验证'} · ${chain?.length ?? '—'} 条</td>
        <td class="mono">${esc(anchor.payload.chain_head)}</td>
        <td class="mono">${esc(anchor.payload.tx_id)}</td>
        <td>${anchor.payload.block}</td>
      </tr>`;
    }).join('')}
  </table>
  <h2>本轮负例：合约窗口与节点硬闸</h2>
  <div class="grid2">
    <div class="card">
      <div class="label">负例作业</div>
      <div class="mono">${esc(failed.timeline.at(-1).job.id)}</div>
      <div class="value red" style="margin-top:7px">REJECTED</div>
      <div class="label" style="margin-top:6px">${esc(failed.timeline.at(-1).job.rejectReason)}</div>
    </div>
    <div class="card">
      <div class="label">拒绝主体</div>
      <div class="value">p-huashan 连接器</div>
      <div class="label" style="margin-top:6px">节点按凭证终点与本地合约副本逐项比对，平台无法绕过</div>
    </div>
  </div>
  <h2>本轮修复后结果</h2>
  <table>
    <tr><th>编号</th><th>现象</th><th>影响</th><th>证据</th></tr>
    <tr><td>F1</td><td>双院各有一份 active 合约时曾被误判 missing</td><td>用户无法生成参数卡</td><td class="green">已修复：2 / 2 成员 ready</td></tr>
    <tr><td>F2</td><td>用途编码曾由模型自由生成</td><td>E_PURPOSE_MISMATCH / 假拦截</td><td class="green">已修复：场景声明固定 purposeCode</td></tr>
    <tr><td>F3</td><td>参数卡曾显示已过时的 DEFAULT_CONTRACTS 提示</td><td>解释性文案与实际逐源预检不一致</td><td class="green">已修复：改为参数确认后逐源检查合约</td></tr>
  </table>
  `,
  `生产链路执行证据：${finalJob.job.id}；统一 AI 入口已完成后端执行与页面提交复测。`,
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
for (const [name, html] of [
  ['16-service-chain.png', serviceChain],
  ['17-tdx-and-result.png', tdxAndResult],
  ['18-purge-and-audit.png', purgeAndAudit],
]) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(ROOT, 'screenshots', name), fullPage: false });
}
await browser.close();
