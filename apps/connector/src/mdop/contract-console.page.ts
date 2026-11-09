/**
 * 院内合约签署台（连接器自带页面，D-MDOP-4 第 3 步的浏览器形态）。
 *
 * 为什么放在连接器里而不是控制台：签署用的是**本院私钥**，平台不持有、也不该代签。
 * 页面本身是纯静态 HTML（不含任何数据），真正的动作全部走 `/connector/mdop/contracts`
 * 的本地管理端点，仍需 `CONNECTOR_LOCAL_ADMIN_TOKEN`。因此：
 *  - 生产部署：只允许在本机 / 院内网访问（`http://127.0.0.1:5022/connector/admin`）；
 *  - 演示部署：可经 nginx 放在 web.szchada.top 的路径下（见 deploy/ali29/compose.sim-admin.yaml），
 *    那只是可达性放宽，鉴权仍是本地令牌。
 *
 * 页面里的 API 路径**按当前 pathname 推导**（`/…/connector/admin` → `/…/connector/mdop/contracts`），
 * 这样直连 `http://127.0.0.1:5022/connector/admin` 和反代到 `/hosp-a/connector/admin` 都不改代码。
 */
export const CONTRACT_CONSOLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>院内合约签署台</title>
<style>
  :root { color-scheme: light dark; --line:#d6dae0; --dim:#5b6472; --bg:#f6f7f9; --card:#fff; --ok:#0f7b43; --warn:#9a5b00; --red:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --line:#2c333d; --dim:#98a2b3; --bg:#14181d; --card:#1b2027; --ok:#4ade80; --warn:#fbbf24; --red:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:inherit; font:14px/1.55 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: var(--dim); font-size: 12px; margin-bottom: 18px; }
  .card { background: var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:14px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  input[type=password], input[type=text] { padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; min-width:220px; font:inherit; }
  button { padding:7px 14px; border-radius:8px; border:1px solid var(--line); background:transparent; color:inherit; font:inherit; cursor:pointer; }
  button.primary { background:#111; color:#fff; border-color:#111; }
  button.danger { color: var(--red); border-color: var(--red); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:8px 6px; border-top:1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight:500; font-size:12px; border-top:none; }
  .tag { display:inline-block; padding:1px 7px; border-radius:999px; border:1px solid var(--line); font-size:11px; color:var(--dim); }
  .msg { margin-top:10px; font-size:13px; }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .err { color: var(--red); }
  .note { font-size:12px; color:var(--dim); }
  .hide { display:none; }
  summary { cursor:pointer; color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>院内合约签署台</h1>
  <div class="sub">
    签署用**本院连接器私钥**，平台不持有、也无法代签；平台只做验签与副署。
    这一步完成后，合约才会从「已发出要约」变为「已生效」。
  </div>

  <div class="card">
    <div class="row">
      <input id="token" type="password" placeholder="本地管理令牌 CONNECTOR_LOCAL_ADMIN_TOKEN" autocomplete="off" />
      <input id="actor" type="text" placeholder="你的院内身份（写进审计）" />
      <button id="save" class="primary">解锁</button>
      <button id="refresh">刷新</button>
    </div>
    <div class="msg" id="status">未解锁。令牌只保存在本标签页（sessionStorage），关闭即失效。</div>
  </div>

  <div class="card hide" id="pendingCard">
    <div class="row" style="justify-content:space-between">
      <strong>待确认要约</strong>
      <span class="note" id="pendingCount"></span>
    </div>
    <div id="pendingBody"></div>
  </div>

  <div class="card hide" id="contractsCard">
    <div class="row" style="justify-content:space-between">
      <strong>本院已签合约</strong>
      <span class="note">「待平台副署」的本地副本还不能授权作业。</span>
    </div>
    <div id="contractsBody"></div>
  </div>

  <details class="card">
    <summary>这一步在整条链里是什么位置？</summary>
    <p class="note" style="margin-bottom:0">
      药企申请合约（业务层，平台记录）→ 平台向本院连接器发出要约 → <b>本院在本页签署</b> →
      平台验签并副署 → 本院本地副本生效 → 药企发起作业时本院 worker 自动拉取执行，
      PEP 与输出闸门在本地强制合约约束。院方的授权点在<b>这次签署</b>，不是逐任务点头。
    </p>
  </details>
</div>

<script>
(function () {
  var base = location.pathname.replace(/\\/admin\\/?$/, '');
  var api = base + '/mdop/contracts';
  var tokenEl = document.getElementById('token');
  var actorEl = document.getElementById('actor');
  var statusEl = document.getElementById('status');
  var pendingCard = document.getElementById('pendingCard');
  var contractsCard = document.getElementById('contractsCard');

  function token() { return sessionStorage.getItem('connector-admin-token') || ''; }
  function actor() { return sessionStorage.getItem('connector-admin-actor') || 'local-admin'; }
  function setMsg(text, cls) {
    statusEl.innerHTML = '';
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    statusEl.appendChild(span);
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function call(method, url, body) {
    return fetch(url, {
      method: method,
      headers: {
        'content-type': 'application/json',
        'x-connector-admin-token': token(),
        // HTTP 头只接受 ISO-8859-1：中文身份必须 percent-encode，服务端会解码后留痕
        'x-connector-admin-actor': encodeURIComponent(actor())
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw new Error((data && (data.message || data.error)) || ('HTTP ' + r.status));
        return data;
      });
    });
  }
  function terms(row) {
    try {
      var c = JSON.parse(row.canonical);
      return {
        purpose: c.purpose, minCell: c.publication && c.publication.minCell,
        validUntil: c.valid_until, recipients: (c.recipients || []).map(function (r) { return r.party; })
      };
    } catch (e) { return {}; }
  }
  function fmt(t) { return t ? String(t).replace('T', ' ').slice(0, 16) : '—'; }

  function renderPending(pending) {
    var body = document.getElementById('pendingBody');
    body.innerHTML = '';
    document.getElementById('pendingCount').textContent = pending.length + ' 份';
    if (!pending.length) { body.appendChild(el('p', { class: 'note' }, '没有待确认要约。')); return; }
    var table = el('table');
    var head = el('tr');
    ['合约', '用途', 'minCell', '截止', '动作'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    pending.forEach(function (p) {
      var t = terms(p) || {};
      var tr = el('tr');
      var c1 = el('td');
      c1.appendChild(el('div', { class: 'mono' }, p.contractId));
      c1.appendChild(el('div', { class: 'note' }, 'offer ' + String(p.offerId).slice(-12)));
      tr.appendChild(c1);
      tr.appendChild(el('td', null, t.purpose || '—'));
      tr.appendChild(el('td', null, t.minCell === undefined ? '—' : String(t.minCell)));
      tr.appendChild(el('td', { class: 'mono' }, fmt(p.expiresAt)));
      var act = el('td');
      var ok = el('button', { class: 'primary' }, '签署');
      ok.onclick = function () { confirmOffer(p, ok); };
      var no = el('button', { class: 'danger' }, '拒绝');
      no.style.marginLeft = '6px';
      no.onclick = function () { rejectOffer(p, no); };
      act.appendChild(ok); act.appendChild(no);
      tr.appendChild(act);
      table.appendChild(tr);
    });
    body.appendChild(table);
  }

  function renderContracts(contracts) {
    var body = document.getElementById('contractsBody');
    body.innerHTML = '';
    if (!contracts.length) { body.appendChild(el('p', { class: 'note' }, '本院还没有本地合约副本。')); return; }
    var table = el('table');
    var head = el('tr');
    ['合约', '用途', '本地状态', '平台副署', '有效期'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    contracts.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'mono' }, c.contractId));
      tr.appendChild(el('td', null, c.purposeCode || '—'));
      var st = el('td');
      var tone = c.status === 'active' ? 'ok' : (c.status === 'revoked' || c.status === 'rejected' ? 'err' : 'warn');
      st.appendChild(el('span', { class: 'tag ' + tone }, c.status));
      tr.appendChild(st);
      tr.appendChild(el('td', { class: 'mono' }, c.platformCountersignature ? '已副署' : '待副署'));
      tr.appendChild(el('td', { class: 'mono' }, fmt(c.validUntil)));
      table.appendChild(tr);
    });
    body.appendChild(table);
  }

  function load() {
    if (!token()) { setMsg('未解锁。令牌只保存在本标签页（sessionStorage），关闭即失效。'); return; }
    pendingCard.classList.remove('hide');
    contractsCard.classList.remove('hide');
    setMsg('读取本院本地合约…');
    call('GET', api).then(function (data) {
      renderPending(data.pending || []);
      renderContracts(data.contracts || []);
      setMsg('已解锁 · 本院本地数据在浏览器内渲染，未发往平台。', 'ok');
    }).catch(function (e) {
      pendingCard.classList.add('hide');
      contractsCard.classList.add('hide');
      setMsg('解锁失败：' + e.message, 'err');
    });
  }

  function confirmOffer(p, btn) {
    var t = terms(p) || {};
    var lines = [
      '确认用本院私钥签署这份合约？',
      '',
      '合约：' + p.contractId,
      '用途：' + (t.purpose || '—'),
      '最小单元格：' + (t.minCell === undefined ? '—' : t.minCell),
      '有效期至：' + fmt(t.validUntil),
      '签署身份：' + actor(),
      '',
      '签署后平台会立即验签并副署；副署到齐前本地副本不授权作业。'
    ];
    if (!window.confirm(lines.join('\\n'))) return;
    btn.disabled = true;
    call('POST', api + '/pending/' + encodeURIComponent(p.offerId) + '/confirm')
      .then(function (a) {
        setMsg('已签署 ' + a.contractId + '（review=' + a.review + '），ContractAgree 已发往平台，等待副署。', 'ok');
        load();
      })
      .catch(function (e) { setMsg('签署失败：' + e.message, 'err'); btn.disabled = false; });
  }

  function rejectOffer(p, btn) {
    var reason = window.prompt('拒绝原因（会写进本院审计）：', '用途或条款不符');
    if (reason === null) return;
    btn.disabled = true;
    call('POST', api + '/pending/' + encodeURIComponent(p.offerId) + '/reject', { reason: reason })
      .then(function () { setMsg('已拒绝该要约。', 'ok'); load(); })
      .catch(function (e) { setMsg('拒绝失败：' + e.message, 'err'); btn.disabled = false; });
  }

  document.getElementById('save').onclick = function () {
    sessionStorage.setItem('connector-admin-token', tokenEl.value.trim());
    sessionStorage.setItem('connector-admin-actor', actorEl.value.trim() || 'local-admin');
    load();
  };
  document.getElementById('refresh').onclick = load;
  tokenEl.value = token();
  actorEl.value = sessionStorage.getItem('connector-admin-actor') || '';
  if (token()) load();
})();
</script>
</body>
</html>`;
