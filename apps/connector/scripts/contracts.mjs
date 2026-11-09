#!/usr/bin/env node
/**
 * 合约本地确认 CLI（仅院内访问，D-MDOP-4 / 任务 5.4）。
 *
 *   node apps/connector/scripts/contracts.mjs list
 *   node apps/connector/scripts/contracts.mjs confirm <offerId>
 *   node apps/connector/scripts/contracts.mjs reject  <offerId> --reason '用途不符'
 *   node apps/connector/scripts/contracts.mjs revoke  <contractId> --reason '院内撤回同意'
 *
 * 走连接器**本地**管理端点（缺省 http://127.0.0.1:$CONNECTOR_PORT），用
 * `CONNECTOR_LOCAL_ADMIN_TOKEN` 认证；`--actor` 记录是谁做的决定（进审计）。
 * 手动确认缺省；自动确认只能由本地策略文件显式点名（见 local-contract-policy.ts）。
 */
const args = process.argv.slice(2);
const cmd = args[0];
const target = args[1];
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const port = process.env.CONNECTOR_PORT ?? '5022';
// 缺省打同机回环；要用别的地址（例如从院内跳板机执行）就显式 --url。
const base = (readFlag('--url', `http://127.0.0.1:${port}`)).replace(/\/$/, '');
const token = (process.env.CONNECTOR_LOCAL_ADMIN_TOKEN ?? '').trim();
const actor = readFlag('--actor', process.env.USER ?? 'local-admin');

if (!token) {
  console.error(
    '未配置 CONNECTOR_LOCAL_ADMIN_TOKEN：本地管理接口不提供缺省令牌（fail-closed）。',
  );
  process.exit(2);
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Connector-Admin-Token': token,
      'X-Connector-Admin-Actor': actor,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[失败] ${res.status} ${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

switch (cmd) {
  case 'list': {
    const out = await call('GET', '/connector/mdop/contracts');
    console.log(`本地合约 ${out.contracts.length} 份，待确认要约 ${out.pending.length} 份：`);
    for (const c of out.contracts)
      console.log(`  [${c.status}] ${c.contractId} 用途=${c.purposeCode} 复核=${c.reviewPolicy ?? '-'}`);
    for (const p of out.pending)
      console.log(`  [待确认] offer=${p.offerId} contract=${p.contractId} 截止=${p.expiresAt}`);
    break;
  }
  case 'confirm': {
    if (!target) throw new Error('用法：confirm <offerId>');
    const agreement = await call(
      'POST',
      `/connector/mdop/contracts/pending/${encodeURIComponent(target)}/confirm`,
    );
    console.log('已用本院私钥签署该合约（本地留痕 review=%s）：', agreement.review);
    console.log(`  contractId      ${agreement.contractId}`);
    console.log(`  holderSignature ${String(agreement.holderSignature).slice(0, 32)}…`);
    console.log('');
    console.log('连接器已把 ContractAgree 发往平台；平台验签并副署后本地副本转 active。');
    console.log('浏览器里做同样的事：http://127.0.0.1:5022/connector/admin');
    console.log(
      '\n提示：平台副署到齐前本地副本为 pending，尚不能授权作业（复核只认生效的本地副本）。',
    );
    break;
  }
  case 'reject': {
    if (!target) throw new Error('用法：reject <offerId> --reason <文本>');
    await call('POST', `/connector/mdop/contracts/pending/${encodeURIComponent(target)}/reject`, {
      reason: readFlag('--reason', '未说明'),
    });
    console.log(`已拒绝要约 ${target}`);
    break;
  }
  case 'revoke': {
    if (!target) throw new Error('用法：revoke <contractId> --reason <文本>');
    const notice = await call(
      'POST',
      `/connector/mdop/contracts/${encodeURIComponent(target)}/revoke`,
      { reason: readFlag('--reason', '院内撤销') },
    );
    console.log('本地撤销已立即生效：引用该合约的片段即刻被拒（与平台是否已知无关）。');
    console.log('把终止通知转交平台：');
    console.log(JSON.stringify(notice, null, 2));
    break;
  }
  default:
    console.error(
      '用法：contracts.mjs <list|confirm|reject|revoke> [id] [--reason <文本>] [--actor <标识>]',
    );
    process.exit(2);
}
