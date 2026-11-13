import { BadRequestException, Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { LocalAdminGuard } from '../mdop/local-admin.guard';
import { ConnectorEnrollmentClient } from './connector-enrollment.client';

@Controller('local')
export class LocalPageController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return LOCAL_PAGE;
  }
}

@Controller('connector/local')
@UseGuards(LocalAdminGuard)
export class LocalConsoleController {
  constructor(private readonly enrollment: ConnectorEnrollmentClient) {}

  @Get('status')
  async status() {
    const base = this.enrollment.status();
    return { ...base, pending: await this.enrollment.pendingContracts() };
  }

  @Post('keys')
  generateKey() {
    return this.guard(() => this.enrollment.generateKey());
  }

  @Post('enroll')
  apply() {
    return this.guard(() => this.enrollment.apply());
  }

  @Post('confirm')
  confirm(
    @Body('offerId') offerId: string,
    @Req() req: { localAdminActor?: string },
  ) {
    return this.guard(() => this.enrollment.confirmOffer(offerId, req.localAdminActor ?? 'local-admin'));
  }

  private async guard<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}

const LOCAL_PAGE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8" />
<title>本院连接器</title>
<style>
  body { font: 15px/1.5 sans-serif; margin: 2rem auto; max-width: 42rem; color: #17202a; }
  h1 { font-size: 1.4rem; }
  section { border: 1px solid #d5dde5; border-radius: 8px; padding: 1rem 1.2rem; margin: 1rem 0; }
  button { margin-right: .5rem; }
  code, .mono { font-family: ui-monospace, monospace; font-size: .85rem; word-break: break-all; }
  .err { color: #9b1c1c; }
  .ok { color: #0f6b3a; }
  label { display: block; margin: .4rem 0; }
  input { width: 100%; box-sizing: border-box; }
</style>
<h1>本院连接器</h1>
<p>密钥和合约确认都在这台机器上完成。私钥不会发给平台。</p>
<section>
  <label>院内管理口令 <input id="token" type="password" autocomplete="off" /></label>
  <button id="load">读取状态</button>
  <p id="msg"></p>
</section>
<section>
  <h2>入网</h2>
  <div id="enroll"></div>
  <button id="key">生成本机密钥</button>
  <button id="apply">申请入网</button>
</section>
<section>
  <h2>待确认合约</h2>
  <div id="offers">请先读取状态</div>
</section>
<script>
  const tokenInput = document.getElementById('token');
  const msg = document.getElementById('msg');
  const saved = sessionStorage.getItem('connector-admin-token') || '';
  tokenInput.value = saved;
  function headers() {
    sessionStorage.setItem('connector-admin-token', tokenInput.value);
    return { 'Content-Type': 'application/json', 'X-Connector-Admin-Token': tokenInput.value };
  }
  function show(text, ok) {
    msg.className = ok ? 'ok' : 'err';
    msg.textContent = text;
  }
  async function call(path, method, body) {
    const res = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(text || String(res.status));
    return text ? JSON.parse(text) : {};
  }
  async function render() {
    const data = await call('/connector/local/status', 'GET');
    document.getElementById('enroll').innerHTML =
      '<div>参与方 <span class="mono">' + (data.participantId || '—') + '</span></div>' +
      '<div>连接器 <span class="mono">' + (data.connectorId || '—') + '</span></div>' +
      '<div>公钥 <span class="mono">' + (data.publicKey || '尚未生成') + '</span></div>' +
      '<div>状态 ' + (data.status || '未申请') + (data.fingerprint ? ' · 指纹 ' + data.fingerprint : '') + '</div>' +
      (data.lastError ? '<div class="err">' + data.lastError + '</div>' : '');
    const offers = data.pending || [];
    document.getElementById('offers').innerHTML = offers.length
      ? offers.map((o) => '<div>要约 <span class="mono">' + o.offerId + '</span> <button data-offer="' + o.offerId + '">确认</button></div>').join('')
      : '没有待确认要约';
  }
  document.getElementById('load').onclick = () => render().then(() => show('已更新', true)).catch((e) => show(e.message, false));
  document.getElementById('key').onclick = () => call('/connector/local/keys', 'POST').then(() => render()).then(() => show('密钥已在本机', true)).catch((e) => show(e.message, false));
  document.getElementById('apply').onclick = () => call('/connector/local/enroll', 'POST').then(() => render()).then(() => show('已提交，等待运营方批准', true)).catch((e) => show(e.message, false));
  document.getElementById('offers').onclick = async (event) => {
    const offer = event.target && event.target.dataset && event.target.dataset.offer;
    if (!offer) return;
    try {
      await call('/connector/local/confirm', 'POST', { offerId: offer });
      show('已签署并提交平台副署', true);
      await render();
    } catch (err) {
      show(err.message, false);
    }
  };
</script>
`;
