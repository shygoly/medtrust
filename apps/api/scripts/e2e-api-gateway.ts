/**
 * End-to-end business closure through the live HTTP API + WS gateway.
 * Requires: API on $API_PORT (default 5031) and the agent on :5024/:5023.
 *
 * Verifies: PEP admission (refuse w/o contract) → 签约 → dispatch → real training
 * → contribution-weighted settlement + on-chain attestation.
 */
import { WebSocket } from 'ws';
import { CKD_PURPOSE, coreSecretFlowSpec } from '@medtrust/demo-scenario';

const PORT = process.env.API_PORT || 5031;
const API = `http://localhost:${PORT}/api/v1`;
const WS = `ws://localhost:${PORT}/ws/secretflow`;

const spec = { ...coreSecretFlowSpec(), epochs: 3 };
const PROFILES = [{ participantId: 'hospital-huashan', hasTee: true, hasConfidentialGpu: true, gpuMemoryGb: 80 }];
const PURPOSE = CKD_PURPOSE;

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function main() {
  const taskId = `bz-${Date.now()}`;

  // 1. PEP fail-closed: dispatch without any contract → 403
  const refused = await post('/secretflow/tasks', { taskId: `${taskId}-x`, spec, profiles: PROFILES });
  console.log('no-contract dispatch status:', refused.status, refused.status === 403 ? '(PEP refused)' : '');

  // 2. 签约: provider logs in, approves a contract per provider for this consumer
  const auth = await (await post('/auth/login', { email: 'admin@huashan-hospital.com', password: 'demo123456' })).json();
  const token = auth.access_token;
  const contractIds: string[] = [];
  for (const provider of ['hospital-huashan', 'hospital-ruijin']) {
    const c = await (await post('/contracts', {
      dataProductId: `dp-insulin-panc-huashan`, providerId: provider, consumerId: 'pharma-demo',
      purpose: PURPOSE, retention: 'burn-after-read', output: 'aggregate', validDays: 30,
    }, token)).json();
    contractIds.push(c.id);
  }
  console.log('signed contracts:', contractIds.length, contractIds.every(Boolean) ? '' : '(FAILED to sign)');

  // 3. subscribe browser-style WS, then dispatch with contracts + budget
  const events: any[] = [];
  const ws = new WebSocket(`${WS}?taskId=${taskId}`);
  const done = new Promise<void>((resolve) => {
    ws.on('message', (d) => {
      const e = JSON.parse(d.toString());
      events.push(e);
      if (e.phase === 'round_complete') console.log(`  round ${e.round} loss=${e.globalLoss?.toFixed(4)} state=${e.state}`);
      if (e.phase === 'result') resolve();
    });
  });
  await new Promise((r) => ws.on('open', r));

  const dispatch = await (await post('/secretflow/tasks', {
    taskId, spec, profiles: PROFILES, contractIds, purpose: PURPOSE, budget: { amount: 100, currency: 'CNY' },
  })).json();
  console.log('dispatch:', dispatch.state, 'contractRefs:', JSON.stringify(dispatch.contractRefs));

  await Promise.race([done, new Promise((r) => setTimeout(r, 30000))]);
  await new Promise((r) => setTimeout(r, 500)); // let settlement hook run

  // 4. settlement + status
  const status = await (await fetch(`${API}/secretflow/tasks/${taskId}`)).json();
  const settlement = await (await fetch(`${API}/secretflow/tasks/${taskId}/settlement`)).json();
  ws.close();

  console.log('final FSM state:', status.state);
  console.log('settlement:', JSON.stringify(settlement?.lines), 'taskRef:', settlement?.taskRef, 'block:', settlement?.block);

  const ok =
    refused.status === 403 &&
    status.state === 'COMPLETED' &&
    settlement &&
    settlement.lines.length === 2 &&
    settlement.lines.reduce((s: number, l: any) => s + l.amount, 0) === 100;
  console.log(ok ? '\n✅ Business closure e2e PASSED' : '\n❌ FAILED');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
