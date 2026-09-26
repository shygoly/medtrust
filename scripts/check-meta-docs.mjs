#!/usr/bin/env node
/**
 * check-meta-docs.mjs — 校验根契约（DECISIONS / DOMAIN / FLOWS / TRUST / ARCHITECTURE 引用）
 * 与代码的一致性。契约格式见各文件附录。零依赖，node scripts/check-meta-docs.mjs 运行。
 * 退出码：有 [ERR] 则 1，否则 0（[WARN] 不影响退出码）。
 *
 * 校验规则总表：
 *   DECISIONS.md  decision 块格式/唯一性；代码决策标记 (Dn) 与 D-AREA-NN 必须在册。
 *   DOMAIN.md     覆盖矩阵 ↔ packages/database 的 @Entity 全表对拍；平面唯一性；
 *                 invariant 块格式；enforcement/spec 路径与符号存在性。
 *   FLOWS.md      flow 块格式；步骤 crosses/payload 枚举；红线：payload=raw-local
 *                 禁止出现在跨域边；actor 存在性；dead_edge_check 成对。
 *   TRUST.md      control 块格式；敏感字段分级表 ↔ @EncryptedColumn/@Masked 双向对拍。
 *   AGENT.md      agent 块格式；R1 连接器平面 agent 禁止（含 LLM 调用点反向扫描）；
 *                 R2 取数须持自有身份；R3 via-pep 须含 PEP token；R4 vendor 须有 flow 在册；
 *                 R5 external-runtime 须声明 runtime/egress/outputs-verified-by 且禁 via-pep
 *                 （该平面代码不在 apps/，反向对拍失效，以登记册替代）。
 *                 注：``yaml agent-draft`` 块不解析（未实现 agent 的边界评审，见 AGENT.md §5）。
 *   ARCHITECTURE.md  反引号仓内路径存在性（仅 WARN）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = resolve(dirname(fileURLToPath(import.meta.url)), 'check-meta-docs.mjs');

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`[ERR] ${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`[WARN] ${where}: ${msg}`);

// ---------- 通用工具 ----------
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'build', '.turbo', 'data']);

function* walk(dir, exts) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, exts);
    else if (exts.some((e) => entry.name.endsWith(e))) yield full;
  }
}

/** 提取 info-string 为 `lang kind` 的围栏块，返回 [{body, line}] */
function fencedBlocks(text, kind) {
  const out = [];
  const lines = text.split('\n');
  let inside = false, body = [], startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inside && l.trim() === '```' + kind) { inside = true; body = []; startLine = i + 1; continue; }
    if (inside && l.trim() === '```') { inside = false; out.push({ body: body.join('\n'), line: startLine + 1 }); continue; }
    if (inside) body.push(l);
  }
  if (inside) throw new Error(`未闭合的 \`\`\`${kind} 块（起于行 ${startLine + 1}）`);
  return out;
}

const field = (body, name) => (body.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')) || [])[1]?.trim();
const hasField = (body, name) => new RegExp(`^${name}:`, 'm').test(body);
const inlineArr = (v) => (v || '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
/** 提取 `key:` 之后缩进的 `- item` 列表 */
function listField(body, name) {
  const m = body.match(new RegExp(`^${name}:\\s*$([\\s\\S]*?)(?=^\\S|$(?![\\s\\S]))`, 'm'));
  if (!m) { const v = field(body, name); return v && v.startsWith('[') ? inlineArr(v) : v ? [v] : []; }
  return [...m[1].matchAll(/^\s+-\s+(.+)$/gm)].map((x) => x[1].trim());
}
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** 校验 ts:/py:/ui: 路径#符号 token；ctx 用于报错定位 */
function checkPathToken(token, ctx) {
  const m = token.match(/^(ts|py|ui|db-fk|ext|typeorm|none)(?::(.*))?$/s);
  if (!m) { err(ctx, `非法强制点/actor token：${token}`); return; }
  const [, kind, rest] = m;
  if (kind === 'none' || kind === 'typeorm' || kind === 'ext' || kind === 'db-fk') return; // db-fk：SQLite synchronize 环境暂不校验
  const [path, symbol] = (rest || '').split('#');
  if (!path) { err(ctx, `${kind}: token 缺路径：${token}`); return; }
  const full = join(ROOT, path);
  if (!existsSync(full)) { err(ctx, `路径不存在：${path}`); return; }
  if (symbol && kind === 'ts') {
    const text = readFileSync(full, 'utf8');
    if (!text.includes(symbol)) err(ctx, `符号 ${symbol} 在 ${path} 中检索不到`);
  }
  // py: v1 只查文件存在（P-3：v2 升符号级）
}

// ---------- 1. DECISIONS.md ----------
const registeredDecisions = new Set();
{
  const p = join(ROOT, 'DECISIONS.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    for (const b of fencedBlocks(text, 'yaml decision')) {
      const id = field(b.body, 'id');
      const ctx = `DECISIONS.md:${b.line}`;
      if (!id) { err(ctx, 'decision 块缺 id'); continue; }
      if (!/^D\d{1,2}$/.test(id) && !/^D-[A-Z]+-\d{1,2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (registeredDecisions.has(id)) err(ctx, `id 重复：${id}`);
      registeredDecisions.add(id);
      for (const f of ['title', 'status', 'date', 'context', 'decision', 'references'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      for (const sub of inlineArr(field(b.body, 'sub_ids'))) {
        if (!/^D-[A-Z]+-\d{1,2}-[a-z]$/.test(sub)) err(ctx, `sub_id 格式非法：${sub}`);
        registeredDecisions.add(sub);
      }
    }
    // 代码侧标记反向对拍
    const CODE_DIRS = ['apps', 'packages', 'scripts', 'fly-services'].map((d) => join(ROOT, d));
    const EXTS = ['.ts', '.js', '.mjs', '.py', '.java', '.sol'];
    for (const dir of CODE_DIRS) {
      for (const file of walk(dir, EXTS)) {
        if (resolve(file) === SELF) continue;
        const text = readFileSync(file, 'utf8');
        const rel = file.slice(ROOT.length + 1);
        for (const m of text.matchAll(/\(D(\d{1,2})\)/g))
          if (!registeredDecisions.has('D' + m[1])) err(rel, `决策标记 (D${m[1]}) 未在 DECISIONS.md 在册`);
        for (const m of text.matchAll(/\bD-[A-Z]+-\d{1,2}(?:-[a-z])?\b/g))
          if (!registeredDecisions.has(m[0])) err(rel, `决策标记 ${m[0]} 未在 DECISIONS.md 在册`);
      }
    }
  } else warn('DECISIONS.md', '文件不存在，跳过');
}

// ---------- 2. DOMAIN.md ----------
{
  const p = join(ROOT, 'DOMAIN.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    // 2a. 覆盖矩阵 ↔ @Entity 对拍
    const matrix = new Map(); // table -> {plane, section}
    const mSec = text.match(/^## 覆盖矩阵\s*$([\s\S]*?)(?=^## )/m);
    if (!mSec) err('DOMAIN.md', '缺「## 覆盖矩阵」小节');
    else {
      for (const row of mSec[1].matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
        const [, table, plane, section] = row;
        if (table === '实体表' || /^[-\s:]+$/.test(table)) continue;
        if (matrix.has(table)) err('DOMAIN.md·覆盖矩阵', `表 ${table} 重复登记（平面必须唯一）`);
        if (!['control-plane', 'connector-local'].includes(plane))
          err('DOMAIN.md·覆盖矩阵', `表 ${table} 平面非法：${plane}（只许 control-plane|connector-local）`);
        matrix.set(table, { plane, section });
      }
    }
    const entities = new Map(); // table -> file
    for (const file of walk(join(ROOT, 'packages/database/src'), ['.ts'])) {
      if (file.includes('.example.')) continue; // 示例实体（如 patient.entity.example.ts）不入矩阵
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(ROOT.length + 1);
      for (const m of src.matchAll(/@Entity\(\s*(?:'([^']+)')?\s*[),]/g)) {
        let name = m[1];
        if (!name) {
          const after = src.slice(m.index).match(/export class (\w+)/);
          name = after ? snake(after[1]) : null;
        }
        if (name) entities.set(name, rel);
      }
    }
    for (const [table, file] of entities)
      if (!matrix.has(table)) err('DOMAIN.md·覆盖矩阵', `实体表 ${table}（${file}）未登记`);
    for (const table of matrix.keys())
      if (!entities.has(table)) err('DOMAIN.md·覆盖矩阵', `登记的表 ${table} 在 packages/database/src 中无对应 @Entity`);
    for (const { section } of matrix.values())
      if (!new RegExp(`^## .*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(text))
        err('DOMAIN.md·覆盖矩阵', `小节「${section}」不存在对应 ## 标题`);
    // 2b. invariant 块
    const invIds = new Set();
    for (const b of fencedBlocks(text, 'yaml invariant')) {
      const id = field(b.body, 'id');
      const ctx = `DOMAIN.md:${b.line}`;
      if (!id) { err(ctx, 'invariant 块缺 id'); continue; }
      if (!/^INV-[A-Z]+(?:-GAP)?-\d{1,2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (invIds.has(id)) err(ctx, `id 重复：${id}`);
      invIds.add(id);
      for (const f of ['tables', 'desc', 'trigger', 'enforcement', 'db', 'spec'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      for (const t of listField(b.body, 'enforcement'))
        if (t !== 'none') checkPathToken(t, `${ctx} ${id}`);
      const spec = field(b.body, 'spec');
      if (spec && spec !== 'TODO' && !existsSync(join(ROOT, spec))) err(ctx, `${id} spec 路径不存在：${spec}`);
      if (spec === 'TODO') warn(ctx, `${id} spec 待补（TODO）`);
    }
  } else warn('DOMAIN.md', '文件不存在，跳过');
}

// ---------- 3. FLOWS.md ----------
{
  const p = join(ROOT, 'FLOWS.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    const CROSSES = ['none', 'consumer→control', 'control→consumer', 'participant→control', 'control→participant', 'control→connector', 'connector→control', 'control→chain', 'connector→local', 'cross-space', 'control→external', 'control→node', 'node→control', 'node→kms'];
    const PAYLOADS = ['task-spec', 'policy', 'aggregate-only', 'evidence-hash', 'raw-local', 'credential', 'catalog-meta', 'prompt-text', 'model-weights', 'none', 'sealed-envelope'];
    const RAW_OK = new Set(['none', 'connector→local']);
    // C2 信封（密文 + 密钥封套）：只许在「持有方 → 控制面」「控制面 → 节点」以及**节点内部**出现；
    // 节点内部仍是密文，解封后的明细只在 `none` 边界内（raw-local 的红线照旧）。
    const SEALED_OK = new Set(['connector→control', 'control→node', 'none']);
    // 出外部第三方（AI 供应商等）的边只许过无患者衍生内容的载荷（CTL-10 / D-AI-1）。
    const EXTERNAL_OK = new Set(['prompt-text', 'none']);
    const flowIds = new Set();
    for (const b of fencedBlocks(text, 'yaml flow')) {
      const id = field(b.body, 'id');
      const ctx = `FLOWS.md:${b.line}`;
      if (!id) { err(ctx, 'flow 块缺 id'); continue; }
      if (!/^FLOW-[A-Z]+-\d{2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (flowIds.has(id)) err(ctx, `id 重复：${id}`);
      flowIds.add(id);
      for (const f of ['name', 'trigger', 'steps'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      // 步骤解析：以 "- actor:" 分段
      const stepChunks = b.body.split(/^\s*-\s+actor:/m).slice(1);
      if (!stepChunks.length) err(ctx, `${id} 无步骤`);
      stepChunks.forEach((chunk, i) => {
        const sctx = `${ctx} ${id} step${i + 1}`;
        const actor = chunk.split('\n')[0].trim();
        checkPathToken(actor, sctx);
        const crosses = (chunk.match(/^\s+crosses:\s*(\S+)/m) || [])[1];
        const payload = (chunk.match(/^\s+payload:\s*(\S+)/m) || [])[1];
        if (!crosses) err(sctx, '缺 crosses 声明');
        else if (!CROSSES.includes(crosses)) err(sctx, `crosses 非法：${crosses}`);
        if (!payload) err(sctx, '缺 payload 声明');
        else if (!PAYLOADS.includes(payload)) err(sctx, `payload 非法：${payload}`);
        else if (payload === 'sealed-envelope' && !SEALED_OK.has(crosses))
          err(sctx, `C2 信封只许走持有方→控制面、控制面→节点或节点内部（收到 ${crosses}）`);
        if (crosses === 'control→external' && payload && !EXTERNAL_OK.has(payload))
          err(sctx, `红线违规：patient-derived 载荷（payload=${payload}）不得流向外部第三方供应商`);
        if (payload === 'raw-local' && crosses && !RAW_OK.has(crosses))
          err(sctx, `红线违规：payload=raw-local 不得出现在跨域边（crosses=${crosses}）`);
        if (!/^\s+produces:/m.test(chunk)) err(sctx, '缺 produces');
        if (!/^\s+consumes:/m.test(chunk)) err(sctx, '缺 consumes');
      });
      // dead_edge_check：至少一条，producer/consumer 成对
      const dec = b.body.match(/^dead_edge_check:\s*$([\s\S]*)/m);
      if (!dec) err(ctx, `${id} 缺 dead_edge_check`);
      else {
        const producers = [...dec[1].matchAll(/^\s+-\s+producer:/gm)].length;
        const consumers = [...dec[1].matchAll(/^\s+consumer:/gm)].length;
        if (!producers) err(ctx, `${id} dead_edge_check 无条目`);
        if (producers !== consumers) err(ctx, `${id} dead_edge_check producer/consumer 不成对（${producers}/${consumers}）`);
      }
    }
  } else warn('FLOWS.md', '文件不存在，跳过');
}

// ---------- 4. TRUST.md ----------
{
  const p = join(ROOT, 'TRUST.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    // 4a. control 块
    const ctlIds = new Set();
    for (const b of fencedBlocks(text, 'yaml control')) {
      const id = field(b.body, 'id');
      const ctx = `TRUST.md:${b.line}`;
      if (!id) { err(ctx, 'control 块缺 id'); continue; }
      if (!/^CTL-\d{2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (ctlIds.has(id)) err(ctx, `id 重复：${id}`);
      ctlIds.add(id);
      for (const f of ['title', 'norm', 'threat', 'enforcement', 'spec', 'evidence'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      for (const t of listField(b.body, 'enforcement'))
        if (t !== 'none') checkPathToken(t, `${ctx} ${id}`);
      const spec = field(b.body, 'spec');
      if (spec && spec !== 'TODO' && !existsSync(join(ROOT, spec))) err(ctx, `${id} spec 路径不存在：${spec}`);
    }
    // 4b. 敏感字段分级表 ↔ 装饰器双向对拍
    const registry = new Map(); // "path#prop" -> {mech}
    const regSec = text.match(/^## 敏感字段分级登记\s*$([\s\S]*?)(?=^## )/m);
    if (!regSec) err('TRUST.md', '缺「## 敏感字段分级登记」小节');
    else {
      for (const row of regSec[1].matchAll(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
        const [, , loc, , mech] = row;
        if (loc.includes('#')) registry.set(loc, { mech });
      }
    }
    const usages = new Map(); // "path#prop" -> decorator
    for (const base of ['packages/database/src', 'apps/api/src']) {
      for (const file of walk(join(ROOT, base), ['.ts'])) {
        if (file.includes('.example.')) continue; // 示例文件的装饰器不要求登记
        const src = readFileSync(file, 'utf8');
        const rel = file.slice(ROOT.length + 1);
        for (const m of src.matchAll(/@(EncryptedColumn|Masked)\(/g)) {
          const after = src.slice(m.index);
          const prop = after.match(/\)\s*(?:@\w+\([^)]*\)\s*)*(?:public\s+|readonly\s+)?(\w+)\s*[?!]?\s*[:;]/);
          if (prop) usages.set(`${rel}#${prop[1]}`, m[1]);
        }
      }
    }
    for (const [key, deco] of usages)
      if (!registry.has(key)) err('TRUST.md·分级表', `@${deco} 使用点 ${key} 未登记`);
    for (const [key, { mech }] of registry) {
      if (/@(EncryptedColumn|Masked)/.test(mech)) {
        if (!usages.has(key)) err('TRUST.md·分级表', `登记行 ${key} 声称装饰器机制，但代码中无对应装饰器`);
      } else {
        const [path, prop] = key.split('#');
        const full = join(ROOT, path);
        if (!existsSync(full)) err('TRUST.md·分级表', `登记行路径不存在：${path}`);
        else if (prop && !readFileSync(full, 'utf8').includes(prop)) err('TRUST.md·分级表', `字段 ${prop} 在 ${path} 中检索不到`);
      }
    }
  } else warn('TRUST.md', '文件不存在，跳过');
}

// ---------- 4b. AGENT.md ----------
{
  const p = join(ROOT, 'AGENT.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    const flowsText = existsSync(join(ROOT, 'FLOWS.md')) ? readFileSync(join(ROOT, 'FLOWS.md'), 'utf8') : '';
    const agtIds = new Set();
    const registeredPaths = new Set(); // 供反向对拍：所有 agent enforcement 里的 ts:/py: 路径
    for (const b of fencedBlocks(text, 'yaml agent')) {
      const id = field(b.body, 'id');
      const ctx = `AGENT.md:${b.line}`;
      if (!id) { err(ctx, 'agent 块缺 id'); continue; }
      if (!/^AGT-\d{2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (agtIds.has(id)) err(ctx, `id 重复：${id}`);
      agtIds.add(id);
      for (const f of ['name', 'plane', 'serves', 'data-access', 'identity', 'vendor', 'enforcement', 'spec'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      const plane = field(b.body, 'plane');
      const access = field(b.body, 'data-access');
      const identity = field(b.body, 'identity');
      const vendor = field(b.body, 'vendor');
      const flow = field(b.body, 'flow');
      const enf = listField(b.body, 'enforcement');
      // R1：连接器平面 agent 一律禁止
      if (plane === 'connector-local')
        err(ctx, `${id} 违反 R1：plane=connector-local 在第一版禁止（连接器上不得运行 agent）`);
      else if (!['control-plane', 'external-runtime'].includes(plane))
        err(ctx, `${id} plane 非法：${plane}（只许 control-plane|external-runtime）`);
      if (access && !['none', 'metadata-only', 'via-pep'].includes(access))
        err(ctx, `${id} data-access 非法：${access}`);
      // R5：外部运行时平面——第 7 条反向对拍扫不到其代码，故以登记册 + 出站收口 + 产物校验替代
      if (plane === 'external-runtime') {
        if (access === 'via-pep')
          err(ctx, `${id} 违反 R5：plane=external-runtime 不得 data-access=via-pep（PEP 经由无法对仓外代码做符号级证明；取数须交回控制面 agent）`);
        for (const f of ['runtime', 'egress', 'outputs-verified-by'])
          if (!hasField(b.body, f))
            err(ctx, `${id} 违反 R5：plane=external-runtime 必须声明 ${f}（本仓反向对拍扫不到其代码）`);
        for (const t of listField(b.body, 'outputs-verified-by'))
          if (t !== 'none') checkPathToken(t, `${ctx} ${id} outputs-verified-by`);
      }
      // R2：取数的 agent 必须持自有身份
      if (access && access !== 'none' && identity !== 'own-cert')
        err(ctx, `${id} 违反 R2：data-access=${access} 但 identity=${identity}（必须 own-cert，禁止继承调用者权限）`);
      // R3：经 PEP 取数的 agent，enforcement 必须含 PEP 强制点
      if (access === 'via-pep' && !enf.some((t) => t.includes('policy-enforcement')))
        err(ctx, `${id} 违反 R3：data-access=via-pep 但 enforcement 未含 PEP token`);
      // R4：调外部供应商必须有 control→external flow 在册
      if (vendor && vendor !== 'none') {
        if (!flow) err(ctx, `${id} 违反 R4：vendor=${vendor} 但缺 flow 字段`);
        else if (!new RegExp(`^id:\\s*${flow}\\s*$`, 'm').test(flowsText))
          err(ctx, `${id} 违反 R4：flow ${flow} 在 FLOWS.md 中不存在`);
      }
      for (const t of enf) {
        if (t !== 'none') checkPathToken(t, `${ctx} ${id}`);
        const m = t.match(/^(?:ts|py):([^#]+)/);
        if (m) registeredPaths.add(m[1]);
      }
      const spec = field(b.body, 'spec');
      if (spec && spec !== 'TODO' && !existsSync(join(ROOT, spec))) err(ctx, `${id} spec 路径不存在：${spec}`);
    }
    // 反向对拍：LLM 客户端实例化点必须在册；且不得位于连接器/agent 平面（R1）
    const LLM_PATTERNS = [/new\s+OpenAI\s*\(/, /new\s+Anthropic\s*\(/, /api\.deepseek\.com/, /generativelanguage\.googleapis/];
    for (const file of walk(join(ROOT, 'apps'), ['.ts', '.py'])) {
      if (resolve(file) === SELF || /\.spec\.|\.test\./.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      if (!LLM_PATTERNS.some((re) => re.test(src))) continue;
      const rel = file.slice(ROOT.length + 1);
      if (rel.startsWith('apps/connector/') || rel.startsWith('apps/agent/'))
        err(rel, `违反 R1：连接器平面出现 LLM 客户端调用（agent 不得下沉到数据平面）`);
      else if (!registeredPaths.has(rel))
        err(rel, `LLM 客户端调用点未在 AGENT.md 登记（须登记为 AGT-x 的 enforcement）`);
    }
  } else warn('AGENT.md', '文件不存在，跳过');
}

// ---------- 5. EVIDENCE.md ----------
{
  const p = join(ROOT, 'EVIDENCE.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    // 5a. evidence 块
    const evdIds = new Set();
    for (const b of fencedBlocks(text, 'yaml evidence')) {
      const id = field(b.body, 'id');
      const ctx = `EVIDENCE.md:${b.line}`;
      if (!id) { err(ctx, 'evidence 块缺 id'); continue; }
      if (!/^EVD-\d{2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (evdIds.has(id)) err(ctx, `id 重复：${id}`);
      evdIds.add(id);
      for (const f of ['title', 'norm', 'risk', 'enforcement', 'spec'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      for (const t of listField(b.body, 'enforcement'))
        if (t !== 'none') checkPathToken(t, `${ctx} ${id}`);
      const spec = field(b.body, 'spec');
      if (spec && spec !== 'TODO' && !existsSync(join(ROOT, spec))) err(ctx, `${id} spec 路径不存在：${spec}`);
      if (spec === 'TODO') warn(ctx, `${id} spec 待补（TODO）`);
    }
    // 5b. 要素覆盖矩阵 ↔ RWS spec 类型字段对拍
    const TYPES_FILE = 'apps/connector/src/domain/types.ts';
    const typesFull = join(ROOT, TYPES_FILE);
    if (!existsSync(typesFull)) err('EVIDENCE.md·覆盖矩阵', `RWS spec 类型文件不存在：${TYPES_FILE}`);
    else {
      const typesText = readFileSync(typesFull, 'utf8');
      const STATES = ['已承载', '部分承载', '缺口'];
      const sec = text.match(/^## 1\. 要素覆盖矩阵[^\n]*$([\s\S]*?)(?=^## )/m);
      if (!sec) err('EVIDENCE.md', '缺「## 1. 要素覆盖矩阵」小节');
      else {
        let rows = 0;
        for (const row of sec[1].matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
          const [, num, element, , carrier, state] = row;
          const ctx = `EVIDENCE.md·覆盖矩阵 #${num}`;
          rows++;
          if (!STATES.includes(state)) { err(ctx, `状态非法：${state}（只许 ${STATES.join(' | ')}）`); continue; }
          const isGap = carrier === '—';
          if (isGap && state !== '缺口') err(ctx, `承载字段为 — 但状态是「${state}」，必须是「缺口」`);
          if (!isGap && state === '缺口') err(ctx, `状态为缺口但声明了承载字段：${carrier}`);
          // 提取 `Type.field` 形式的字段引用并对拍 types.ts（或 db 实体表）
          // —— RwsTaskEntity / RwsAssignmentEntity 等表结构在 packages/database。
          // rws-study-protocol-spec 起部分承载字段（如 protocolVersion）在 DB 实体上。
          const DB_ENTITIES_FILE = 'packages/database/src/control-plane/index.ts';
          const dbEntitiesText = existsSync(join(ROOT, DB_ENTITIES_FILE))
            ? readFileSync(join(ROOT, DB_ENTITIES_FILE), 'utf8')
            : '';
          for (const ref of carrier.matchAll(/`(TteSpec|TteOutcomeSpec|RwsAnalysis|IdentificationAlgorithm|CodeSet|ValidationMetrics|ConfusionMatrix|SapPlan|MissingnessDeclaration|SensitivityAnalysisDeclaration|EffectEstimatePayload|RwsTaskEntity)\.(\w+)`/g)) {
            // Match `field:`, `field?:`, or `field!:` (TS strict-null assertions on entities).
            const fieldPattern = new RegExp(`\\b${ref[2]}!?\\??:`);
            const inTypes = fieldPattern.test(typesText);
            const inDb = dbEntitiesText && fieldPattern.test(dbEntitiesText);
            if (!inTypes && !inDb)
              err(ctx, `字段 ${ref[1]}.${ref[2]} 在 ${TYPES_FILE} 与 ${DB_ENTITIES_FILE} 中均检索不到（要素「${element}」）`);
          }
          if (!isGap && !/`\w+\.\w+`/.test(carrier))
            err(ctx, `承载字段格式非法：${carrier}（须为 \`Type.field\` 或 —）`);
        }
        if (!rows) err('EVIDENCE.md·覆盖矩阵', '矩阵无数据行');
      }
    }
  } else warn('EVIDENCE.md', '文件不存在，跳过');
}

// ---------- 5c. REGULATORY.md ----------
// 契约见 REGULATORY.md「附录：格式契约」。与 §5 EVIDENCE.md 同构，另加两项：
//  (a) 扫描面扩到编排器类型文件（RwsMetaPooledSuccess 等承载 E-value / 异质性字段）；
//  (b) 覆盖矩阵允许 `EVD-xx` / `REG-xx` 控制点引用，并做**跨册悬空引用**校验。
const regIds = new Set();
{
  const p = join(ROOT, 'REGULATORY.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');

    // 5c-1. regulatory 块
    for (const b of fencedBlocks(text, 'yaml regulatory')) {
      const id = field(b.body, 'id');
      const ctx = `REGULATORY.md:${b.line}`;
      if (!id) { err(ctx, 'regulatory 块缺 id'); continue; }
      if (!/^REG-\d{2}$/.test(id)) err(ctx, `id 格式非法：${id}`);
      if (regIds.has(id)) err(ctx, `id 重复：${id}`);
      regIds.add(id);
      for (const f of ['title', 'norm', 'risk', 'enforcement', 'spec'])
        if (!hasField(b.body, f)) err(ctx, `${id} 缺字段 ${f}`);
      for (const t of listField(b.body, 'enforcement'))
        if (t !== 'none') checkPathToken(t, `${ctx} ${id}`);
      const spec = field(b.body, 'spec');
      if (spec && spec !== 'TODO' && !existsSync(join(ROOT, spec))) err(ctx, `${id} spec 路径不存在：${spec}`);
      if (spec === 'TODO') warn(ctx, `${id} spec 待补（TODO）`);
    }

    // 5c-2. 覆盖矩阵 ↔ 类型字段 / 跨册控制点对拍
    const TYPE_FILES = [
      'apps/connector/src/domain/types.ts',
      'packages/database/src/control-plane/index.ts',
      'apps/api/src/runtime/rws-orchestrator/types.ts',
      'apps/api/src/compute-task/dto/rws-analysis-spec.ts',
    ];
    const typeText = TYPE_FILES.filter((f) => existsSync(join(ROOT, f)))
      .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
    const TYPE_WHITELIST = '(?:TteSpec|TteOutcomeSpec|RwsAnalysis|IdentificationAlgorithm|CodeSet|'
      + 'ValidationMetrics|ConfusionMatrix|SapPlan|MissingnessDeclaration|SensitivityAnalysisDeclaration|'
      + 'RwsTaskEntity|RwsMetaPooledSuccess|RwsKmCurve)';
    const evdText = existsSync(join(ROOT, 'EVIDENCE.md'))
      ? readFileSync(join(ROOT, 'EVIDENCE.md'), 'utf8') : '';
    const evdKnown = new Set([...evdText.matchAll(/^\s*id:\s*(EVD-\d{2})\s*$/gm)].map((m) => m[1]));

    const STATES = ['已承载', '部分承载', '缺口'];
    const sec = text.match(/^## 2\. 监管要素覆盖矩阵[^\n]*$([\s\S]*?)(?=^## )/m);
    if (!sec) err('REGULATORY.md', '缺「## 2. 监管要素覆盖矩阵」小节');
    else {
      let rows = 0;
      for (const row of sec[1].matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
        const [, num, element, , carrier, state] = row;
        const ctx = `REGULATORY.md·覆盖矩阵 #${num}`;
        rows++;
        if (!STATES.includes(state)) { err(ctx, `状态非法：${state}（只许 ${STATES.join(' | ')}）`); continue; }
        const isGap = carrier === '—';
        if (isGap && state !== '缺口') err(ctx, `承载为 — 但状态是「${state}」，必须是「缺口」`);
        if (!isGap && state === '缺口') err(ctx, `状态为缺口但声明了承载：${carrier}`);
        if (isGap) continue;
        const hasFieldRef = new RegExp('`' + TYPE_WHITELIST + '\\.\\w+`').test(carrier);
        const hasCtlRef = /`(?:EVD|REG)-\d{2}`/.test(carrier);
        if (!hasFieldRef && !hasCtlRef)
          err(ctx, `承载格式非法：${carrier}（须为 \`Type.field\`、\`EVD-xx\`/\`REG-xx\` 或 —）`);
        for (const ref of carrier.matchAll(new RegExp('`(' + TYPE_WHITELIST + ')\\.(\\w+)`', 'g'))) {
          if (!new RegExp(`\\b${ref[2]}!?\\??:`).test(typeText))
            err(ctx, `字段 ${ref[1]}.${ref[2]} 在四类类型文件中均检索不到（要素「${element}」）`);
        }
        for (const ref of carrier.matchAll(/`(EVD|REG)-(\d{2})`/g)) {
          const id = `${ref[1]}-${ref[2]}`;
          if (ref[1] === 'EVD' && !evdKnown.has(id)) err(ctx, `跨册悬空引用：${id} 在 EVIDENCE.md 中不存在`);
          if (ref[1] === 'REG' && !regIds.has(id)) err(ctx, `悬空引用：${id} 在本册中不存在`);
        }
      }
      if (!rows) err('REGULATORY.md·覆盖矩阵', '矩阵无数据行');
    }
  } else warn('REGULATORY.md', '文件不存在，跳过');
}

// ---------- 6. ARCHITECTURE.md 路径引用（WARN 级） ----------
{
  const p = join(ROOT, 'ARCHITECTURE.md');
  if (existsSync(p)) {
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/`([^`\s*<>|]+\/[^`\s*<>|]+)`/g)) {
      const path = m[1].replace(/^\.\//, '').replace(/:\d+$/, '');
      if (/^(https?:|urn:|@|\/)/.test(path) || path.includes('{') || path.includes('(')) continue;
      if (!existsSync(join(ROOT, path))) warn('ARCHITECTURE.md', `引用路径不存在：${path}`);
    }
  }
}

// ---------- 7. DEPLOY.md 端口与环境变量三方对拍 ----------
// 契约见 DEPLOY.md「附录：格式契约」。扫描面在此显式声明，且与该附录第 4 条逐条一致——
// 两处任一改动都必须同步改另一处，否则对拍面会悄悄缩小（检查器还在跑，只是照不到）。
{
  const p = join(ROOT, 'DEPLOY.md');
  if (!existsSync(p)) warn('DEPLOY.md', '文件不存在，跳过');
  else {
    const text = readFileSync(p, 'utf8');

    /** 取 `## <n>.` 小节正文；§1 在 `### ` 处截断，避免把 §1.1 的表并进来 */
    // 注意：文件末尾锚点必须写成 `$(?![\s\S])`。JS 正则没有 \Z——写 \Z 会被当成字面量 Z，
    // 小节会在第一个大写 Z 处截断（MP_SPDZ_* 那几行曾因此整片丢失）。
    const section = (n) => {
      const m = text.match(new RegExp(`^## ${n}\\..*?$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
      return m ? m[1].split(/^### /m)[0] : '';
    };
    /** 表格数据行 → 单元格数组；只认首列为反引号标识符的行 */
    const rows = (body) => [...body.matchAll(/^\|(.+)\|\s*$/gm)]
      .map((m) => m[1].split('|').map((c) => c.trim()))
      .filter((cs) => /^`[^`]+`$/.test(cs[0]))
      .map((cs) => [cs[0].slice(1, -1), ...cs.slice(1)]);

    const deployRows = rows(section(2));
    const testRows = rows(section(3));
    const ignoreRows = rows(section(5));
    const portRows = rows(section(1));

    // 格式契约先验：任一表解析空转 = 红（附录第 5 条）。
    // 先验不过就不要继续对拍——解析结果不可信，后面的"缺失"全是假的。
    let parseOk = true;
    for (const [name, rs] of [['§1 端口', portRows], ['§2 部署面', deployRows],
      ['§3 测试面', testRows], ['§5 忽略名单', ignoreRows]]) {
      if (!rs.length) { err('DEPLOY.md·格式契约', `${name} 表解析为 0 行（附录第 5 条）`); parseOk = false; }
    }

    if (parseOk) {
      const ignore = new Set(ignoreRows.map((r) => r[0]));
      const docKeys = new Set([...deployRows, ...testRows].map((r) => r[0]).filter((k) => !ignore.has(k)));

      // ── 代码侧扫描面（附录第 4 条）────────────────────────────
      const DEPLOY_DIRS = ['apps/api/src', 'apps/web/src', 'apps/connector/src', 'apps/connector-ml',
        'apps/agent', 'packages/database/src', 'packages/demo-scenario', 'packages/proto'];
      const TEST_DIRS = ['apps/api/scripts', 'scripts'];
      const ENV_SKIP = new Set([...SKIP_DIRS, '.venv', '__pycache__', 'output', '.tokencrusher']);
      const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.py'];

      function* walkEnv(dir) {
        if (!existsSync(dir)) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (ENV_SKIP.has(e.name)) continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) yield* walkEnv(full);
          else if (EXTS.some((x) => e.name.endsWith(x))) yield full;
        }
      }
      // 剥字符串字面量再匹配 process.env.KEY：否则 spec 夹具里的 "process.env.STEAL"
      // 会被当成读取点。DEPLOY.md §5 的两条忽略项即由此而来。
      const stripLiterals = (s) => s.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");

      const codeKeys = new Map();   // key -> 首个读取点（相对路径），用于报错定位
      for (const dir of [...DEPLOY_DIRS, ...TEST_DIRS]) {
        for (const file of walkEnv(join(ROOT, dir))) {
          if (file === SELF) continue;          // 本校验器注释里字面写着 process.env.KEY，扫自己会自证失败
          const raw = readFileSync(file, 'utf8');
          const rel = file.slice(ROOT.length + 1);
          const found = new Set();
          for (const m of stripLiterals(raw).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
          for (const m of raw.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) found.add(m[1]);
          for (const m of raw.matchAll(/configService\.get(?:<[^>]*>)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) found.add(m[1]);
          for (const m of raw.matchAll(/os\.environ(?:\.get)?[([]\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) found.add(m[1]);
          for (const m of raw.matchAll(/getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) found.add(m[1]);
          for (const k of found) if (!ignore.has(k) && !codeKeys.has(k)) codeKeys.set(k, rel);
        }
      }

      // ── 双向对拍（附录第 1 条）：单向子集发现不了死条目 ──────
      for (const k of codeKeys.keys()) {
        if (!docKeys.has(k)) err('DEPLOY.md·§2/§3', `代码读取 ${k}（${codeKeys.get(k)}）但未在 DEPLOY.md 登记`);
      }
      for (const k of docKeys) {
        if (!codeKeys.has(k)) err('DEPLOY.md·§2/§3', `登记的 ${k} 在扫描面内无读取点（死条目，或扫描面漏了它）`);
      }

      // ── 样例文件：只警告（附录第 6 条）──────────────────────
      // 样例文件的键可能由仓外 fly secrets 直接消费，工作区内判不准死活。
      // 判不准就判红会教会人"红是常态"，比没有检查更坏。
      // .env.fly.example 已于 2026-07-31 废弃删除（指向未部署 app + 旧命名，见 DEPLOY §4 第 2 条）。
      const SAMPLES = ['.env.example', 'apps/connector/.env.example'];
      const sampleKeys = new Set();
      for (const s of SAMPLES) {
        const sp = join(ROOT, s);
        if (!existsSync(sp)) { warn('DEPLOY.md·样例', `${s} 不存在`); continue; }
        for (const m of readFileSync(sp, 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)(?==)/gm)) sampleKeys.add(m[1]);
      }
      const missInSample = [...docKeys].filter((k) => !sampleKeys.has(k));
      const orphanInSample = [...sampleKeys].filter((k) => !docKeys.has(k));
      if (missInSample.length) warn('DEPLOY.md·样例', `${missInSample.length} 个已登记键不在任何样例文件（DEPLOY.md §4 第 1 条）`);
      if (orphanInSample.length) warn('DEPLOY.md·样例', `${orphanInSample.length} 个样例文件键无人读取（DEPLOY.md §4 第 1/2 条）`);

      // ── 端口对拍（附录第 3 条）──────────────────────────────
      for (const [port, , src] of portRows) {
        const m = src.match(/`([^`]+)`/);
        if (!m) continue;                       // 「代码缺省」等非文件来源不对拍
        const srcPath = m[1];
        if (srcPath === 'docker-compose') {
          const dc = join(ROOT, 'docker-compose.yml');
          if (!existsSync(dc)) { err('DEPLOY.md·§1', 'docker-compose.yml 不存在'); continue; }
          if (!new RegExp(`"${port}:\\d+"`).test(readFileSync(dc, 'utf8')))
            err('DEPLOY.md·§1', `端口 ${port} 在 docker-compose.yml 的 ports 中不存在`);
        } else if (srcPath.endsWith('.toml')) {
          const tp = join(ROOT, srcPath);
          if (!existsSync(tp)) { err('DEPLOY.md·§1', `来源文件不存在：${srcPath}`); continue; }
          if (!new RegExp(`internal_port\\s*=\\s*${port}\\b`).test(readFileSync(tp, 'utf8')))
            err('DEPLOY.md·§1', `端口 ${port} 在 ${srcPath} 的 internal_port 中不存在`);
        }
      }
    }
  }
}

// ---------- 伪 SM3 守护(TRUST CTL-15 / TC609 P0-5) ----------
// 禁止以 sha256 挂 "SM3:" 前缀冒充国密摘要(D8)。扫描 apps/ + packages/ 源码:
// 同一文件既出现 sha256 摘要调用又出现 "SM3:" 字符串即红(canonical helper sm3.ts 不含 sha256)。
{
  for (const file of [
    ...walk(join(ROOT, 'apps'), ['.ts', '.py']),
    ...walk(join(ROOT, 'packages'), ['.ts']),
  ]) {
    const rel = file.slice(ROOT.length + 1);
    if (rel.endsWith('.spec.ts')) continue;
    const src = readFileSync(file, 'utf8');
    const sha256 = /createHash\(['"]sha256['"]\)|hashlib\.sha256/.test(src);
    const sm3Claim = /SM3:/.test(src);
    if (sha256 && sm3Claim)
      err('TRUST·伪SM3', `${rel} 以 sha256 冒充 SM3 前缀(应经 sm3.ts / GMCryptoService)`);
  }
}

// ---------- 汇总 ----------
for (const w of warnings) console.log(w);
for (const e of errors) console.log(e);
console.log(`\ncheck-meta-docs: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
