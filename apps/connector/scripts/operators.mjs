#!/usr/bin/env node
/**
 * 算子白名单 CLI（仅院内访问，D-MDOP-5 / 任务 6.3）。
 *
 *   node apps/connector/scripts/operators.mjs list
 *   node apps/connector/scripts/operators.mjs add <摘要|id@version> [--kind wasm|system] [--note '说明']
 *   node apps/connector/scripts/operators.mjs remove <摘要|id@version>
 *
 * 白名单**缺省为空**（fail-closed）：不加入就什么都不执行。
 * 平台无法远程改白名单 —— 这条路径只存在于连接器本地（院内网）。
 */
const args = process.argv.slice(2);
const cmd = args[0];
const target = args[1];
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const port = process.env.CONNECTOR_PORT ?? '5022';
const base = readFlag('--url', `http://127.0.0.1:${port}`).replace(/\/$/, '');
const token = (process.env.CONNECTOR_LOCAL_ADMIN_TOKEN ?? '').trim();
const actor = readFlag('--actor', process.env.USER ?? 'local-admin');

if (!token) {
  console.error('未配置 CONNECTOR_LOCAL_ADMIN_TOKEN：本地管理接口不提供缺省令牌（fail-closed）。');
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
    const out = await call('GET', '/connector/mdop/operators');
    console.log(
      `白名单 ${out.whitelist.length} 条；已验签算子清单 ${out.manifestsLoaded} 份；` +
        `吊销名单已同步=${out.revocationSynced}（吊销 ${out.revoked.length} 条）`,
    );
    for (const w of out.whitelist)
      console.log(`  [${w.kind}] ${w.digest}  by=${w.addedBy}${w.note ? `  ${w.note}` : ''}`);
    if (out.whitelist.length === 0)
      console.log('  （空：缺省不执行任何算子，需院内按摘要加入）');
    break;
  }
  case 'add':
    if (!target) throw new Error('用法：add <摘要|id@version>');
    console.log(
      JSON.stringify(
        await call('POST', '/connector/mdop/operators', {
          digest: target,
          ...(readFlag('--kind') ? { kind: readFlag('--kind') } : {}),
          ...(readFlag('--note') ? { note: readFlag('--note') } : {}),
        }),
        null,
        2,
      ),
    );
    break;
  case 'remove':
    if (!target) throw new Error('用法：remove <摘要|id@version>');
    console.log(JSON.stringify(await call('DELETE', `/connector/mdop/operators/${encodeURIComponent(target)}`)));
    break;
  default:
    console.error('用法：operators.mjs <list|add|remove> [摘要|id@version] [--kind wasm|system] [--note 文本]');
    process.exit(2);
}
