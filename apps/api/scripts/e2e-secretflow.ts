/**
 * Cross-language end-to-end smoke for the SecretFlow control→data plane.
 *
 * Requires the Local Data Agent running (apps/agent):
 *   cd apps/agent && PYTHONPATH=src python3 -m medtrust_agent.main
 *
 * Run:
 *   cd apps/api && npx ts-node scripts/e2e-secretflow.ts
 *
 * Verifies: NestJS gRPC SubmitFLTask -> Python agent -> real FedAvg training ->
 * live WebSocket loss curve -> output-gated safe result via gRPC GetTaskResult.
 */
import { WebSocket } from 'ws';
import { coreSecretFlowSpec, SECRETFLOW_SPEC } from '@medtrust/demo-scenario';
import { AgentDispatchClient } from '../src/secretflow-orchestrator/agent-dispatch.client';
import { NodeCapabilityService } from '../src/secretflow-orchestrator/node-capability.service';
import { SecretFlowTranspilerService } from '../src/secretflow-orchestrator/transpiler.service';
import { SecretFlowTaskSpec } from '../src/compute-task/dto/secretflow-task-spec';

const spec: SecretFlowTaskSpec = {
  ...coreSecretFlowSpec(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...( { epochs: SECRETFLOW_SPEC.epochs ?? 4 } as any ),
};

async function main() {
  const agent = new AgentDispatchClient();
  const capability = new NodeCapabilityService();
  const transpiler = new SecretFlowTranspilerService();
  const taskId = `e2e-${Date.now()}`;

  const nodePlan = capability.plan(spec, [
    { participantId: 'hospital-demohospa', device: 'H100', hasTee: true, hasConfidentialGpu: true, gpuMemoryGb: 80 },
    { participantId: 'hospital-demohospb', device: 'V100', hasTee: false },
    { participantId: 'hospital-demohospc', device: 'CPU', hasTee: false },
    { participantId: 'pharma-demo', device: 'CPU', hasTee: false },
  ]);
  console.log('Node plan:', nodePlan.map((n) => `${n.participantId}=${n.tier}`).join(', '));

  const payload = transpiler.transpile(taskId, spec, nodePlan);
  console.log(`Transpiled SecretFlow script: ${payload.split('\n').length} lines`);

  const dispatch = await agent.submitFLTask({
    taskId,
    specYaml: JSON.stringify(spec),
    transpiledPayload: payload,
    nodePlan,
  });
  console.log('Dispatch:', dispatch.ackStatus, '->', dispatch.taskStreamUrl);

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(dispatch.taskStreamUrl);
    ws.on('message', (data) => {
      const e = JSON.parse(data.toString());
      if (e.phase === 'baseline') console.log(`  baseline loss = ${e.global_loss?.toFixed(4)}`);
      if (e.phase === 'round_complete') console.log(`  round ${e.round} global_loss = ${e.global_loss?.toFixed(4)}`);
      if (e.phase === 'done') console.log('  training done:', JSON.stringify(e.metrics));
      if (e.phase === 'result') console.log('  safe result loraDeltaHash =', e.result?.loraDeltaHash);
    });
    ws.on('close', () => resolve());
    ws.on('error', reject);
  });

  const result = await agent.getTaskResult(taskId);
  console.log('GetTaskResult:', result.state, 'runtime=', result.runtime, 'rounds=', result.roundsCompleted);
  console.log('Metrics:', result.metricsJson);
  if (result.state !== 'COMPLETED') {
    throw new Error('task did not complete');
  }
  console.log('\n✅ Cross-language e2e PASSED');
}

main().catch((err) => {
  console.error('❌ e2e failed:', err.message);
  process.exit(1);
});
