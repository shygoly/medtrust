/**
 * RWS pull-loop smoke: consumer submits → provider connector pulls → completes.
 *
 * Prereqs:
 *   - API :5021, connector with CONNECTOR_PARTICIPANT_ID=p-ruijin :5022
 *   - Active contract covering consumer + provider + purpose
 *   - Product fhirSchema.localDataPath points at ingested data
 *   - 迁移期令牌通道:API 侧 CONNECTOR_TOKEN_AUTH_ALLOWED=true,并显式导出
 *     CONNECTOR_PULL_TOKEN(缺省强制证书认证,无缺省令牌)
 *
 * Run:
 *   cd apps/api && npx ts-node scripts/e2e-rws-pull.ts
 */
const API = process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1';
const TOKEN = process.env.CONNECTOR_PULL_TOKEN;
if (!TOKEN) {
  throw new Error(
    '缺少 CONNECTOR_PULL_TOKEN:连接器信道缺省强制证书认证,令牌通道须显式配置(且 API 侧 CONNECTOR_TOKEN_AUTH_ALLOWED=true)',
  );
}
const PROVIDER = process.env.CONNECTOR_PARTICIPANT_ID ?? 'p-ruijin';

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function main() {
  const contractId = process.env.RWS_CONTRACT_ID;
  const purpose = process.env.RWS_PURPOSE ?? '慢病真实世界研究';

  if (!contractId) {
    console.error('Set RWS_CONTRACT_ID to an active digital contract id');
    process.exit(1);
  }

  const jwt = await login('research@meddata-inst.edu.cn', 'demo123456');

  const submit = await fetch(`${API}/rws/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      title: 'e2e RWS pull loop',
      purpose,
      analysis: { type: 'condition-prevalence' },
      contractIds: [contractId],
    }),
  });
  if (!submit.ok) {
    console.error('submit failed:', submit.status, await submit.text());
    process.exit(1);
  }
  const task = (await submit.json()) as { taskId: string };
  console.log('submitted taskId=', task.taskId);

  const pull = await fetch(
    `${API}/connector/rws/pending?participantId=${encodeURIComponent(PROVIDER)}`,
    { headers: { 'X-Connector-Token': TOKEN, 'X-Connector-Participant': PROVIDER } },
  );
  if (!pull.ok) {
    console.error('pull failed:', pull.status, await pull.text());
    process.exit(1);
  }
  const pending = (await pull.json()) as { assignmentId: string }[];
  console.log('pending assignments=', pending.length);
  if (!pending.length) {
    console.log('No pending — ensure connector worker is running or complete manually via connector');
    process.exit(0);
  }

  // If connector worker is running it may have already claimed; poll task status instead.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${API}/rws/tasks/${task.taskId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const status = (await statusRes.json()) as { status: string; merged?: { cohortSize: number } };
    console.log(`poll ${i + 1}: status=${status.status} merged.n=${status.merged?.cohortSize ?? '—'}`);
    if (status.status === 'completed' || status.status === 'partial') {
      console.log('\n✅ RWS pull-loop e2e PASSED');
      return;
    }
    if (status.status === 'failed') {
      throw new Error('task failed');
    }
  }
  throw new Error('timeout waiting for completion');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
