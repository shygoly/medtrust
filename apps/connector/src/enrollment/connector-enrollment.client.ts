import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { generateSm2KeyPair, publicKeyFromPrivateKey } from '@medtrust/mdop';
import { connectorKeyFilePath, loadConnectorPrivateKey } from '../domain/connector-key';
import { signSm2 } from '../domain/sm2-sign';
import { MdopContractStore } from '../mdop/contract-store';
import { MdopNodeService } from '../mdop/mdop-node.service';

const ENROLL_PREFIX = 'connector-enroll.v1';

export interface EnrollmentState {
  enrollmentId?: string;
  pollToken?: string;
  fingerprint?: string;
  status?: string;
  connectorId?: string;
  participantId?: string;
  publicKey?: string;
  caPublicKey?: string;
  platformNodePublicKey?: string;
  registryPublicKey?: string;
  lastError?: string;
}

function statePath(): string {
  return join(process.cwd(), 'data', 'connector-enrollment.json');
}

function readState(): EnrollmentState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as EnrollmentState;
  } catch {
    return {};
  }
}

function writeState(state: EnrollmentState): void {
  const path = statePath();
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function applyStateToEnv(state: EnrollmentState): void {
  const fill = (key: string, value?: string) => {
    if (!process.env[key] && value) process.env[key] = value;
  };
  fill('CONNECTOR_CERT_FINGERPRINT', state.fingerprint);
  fill('CONNECTOR_PLATFORM_CA_PUBKEY', state.caPublicKey);
  fill('CONNECTOR_PLATFORM_NODE_PUBKEY', state.platformNodePublicKey);
  fill('CONNECTOR_REGISTRY_PUBKEY', state.registryPublicKey);
}

@Injectable()
export class ConnectorEnrollmentClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorEnrollmentClient.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly contracts: MdopContractStore,
    private readonly node: MdopNodeService,
  ) {}

  onModuleInit(): void {
    const state = readState();
    applyStateToEnv(state);
    void this.ensurePlatformKeys();
    this.timer = setInterval(() => void this.pollIfPending(), 15_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status(): EnrollmentState & { hasPrivateKey: boolean; pending: Array<{ offerId: string; contractId: string; expiresAt: string }> } {
    const state = readState();
    let publicKey = state.publicKey ?? '';
    let hasPrivateKey = false;
    try {
      const privateKey = loadConnectorPrivateKey();
      hasPrivateKey = !!privateKey;
      if (privateKey) publicKey = publicKeyFromPrivateKey(privateKey);
    } catch (err) {
      state.lastError = (err as Error).message;
    }
    return {
      ...state,
      participantId: process.env.CONNECTOR_PARTICIPANT_ID ?? state.participantId ?? '',
      connectorId: process.env.CONNECTOR_ID ?? state.connectorId ?? '',
      publicKey,
      hasPrivateKey,
      pending: [],
    };
  }

  async pendingContracts() {
    const rows = await this.contracts.listPending();
    return rows.map((row) => ({
      offerId: row.offerId,
      contractId: row.contractId,
      expiresAt: row.expiresAt,
    }));
  }

  generateKey(): { created: boolean; publicKey: string } {
    const existing = loadConnectorPrivateKey();
    if (existing) {
      return { created: false, publicKey: publicKeyFromPrivateKey(existing) };
    }
    const pair = generateSm2KeyPair();
    const path = connectorKeyFilePath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${pair.privateKey}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { created: true, publicKey: pair.publicKey };
  }

  async apply(): Promise<EnrollmentState> {
    const privateKey = loadConnectorPrivateKey();
    if (!privateKey) throw new Error('尚未生成本机私钥');
    const publicKey = publicKeyFromPrivateKey(privateKey);
    const connectorId = (process.env.CONNECTOR_ID ?? '').trim();
    const participantId = (process.env.CONNECTOR_PARTICIPANT_ID ?? '').trim();
    if (!connectorId || !participantId) {
      throw new Error('缺少 CONNECTOR_ID 或 CONNECTOR_PARTICIPANT_ID');
    }
    const timestamp = Date.now().toString();
    const payload = [ENROLL_PREFIX, timestamp, connectorId, participantId, publicKey].join(':');
    const signature = signSm2(payload, privateKey, publicKey);
    const res = await fetch(`${this.api()}/connectors/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId, participantId, subjectPublicKey: publicKey, timestamp, signature }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `入网申请失败 HTTP ${res.status}`);
    const body = JSON.parse(text) as { id: string; pollToken: string; status: string; fingerprint?: string };
    const state: EnrollmentState = {
      ...readState(),
      enrollmentId: body.id,
      pollToken: body.pollToken,
      status: body.status,
      fingerprint: body.fingerprint,
      connectorId,
      participantId,
      publicKey,
      lastError: '',
    };
    writeState(state);
    await this.ensurePlatformKeys();
    if (body.status === 'approved' && body.fingerprint) applyStateToEnv(state);
    return state;
  }

  async pollOnce(): Promise<EnrollmentState> {
    const state = readState();
    if (!state.enrollmentId || !state.pollToken) return state;
    if (state.status === 'approved' && state.fingerprint) return state;
    const res = await fetch(`${this.api()}/connectors/enrollments/${state.enrollmentId}`, {
      headers: { 'X-Enrollment-Poll-Token': state.pollToken },
    });
    const text = await res.text();
    if (!res.ok) {
      state.lastError = text || `轮询失败 HTTP ${res.status}`;
      writeState(state);
      return state;
    }
    const body = JSON.parse(text) as { status: string; fingerprint?: string; rejectReason?: string };
    state.status = body.status;
    state.fingerprint = body.fingerprint ?? state.fingerprint;
    state.lastError = body.status === 'rejected' ? body.rejectReason ?? '已驳回' : '';
    writeState(state);
    if (body.status === 'approved' && state.fingerprint) {
      process.env.CONNECTOR_CERT_FINGERPRINT = state.fingerprint;
      applyStateToEnv(state);
      this.logger.log(`入网已批准，证书指纹已写入本机 ${state.fingerprint}`);
    }
    return state;
  }

  async confirmOffer(offerId: string, actor: string) {
    const agreement = await this.contracts.confirm(offerId, actor);
    await this.node.submitHolderAgreement(agreement);
    return { offerId, contractId: agreement.contractId, sent: true };
  }

  private async pollIfPending(): Promise<void> {
    const state = readState();
    if (!state.enrollmentId || state.status === 'approved' || state.status === 'rejected') return;
    try {
      await this.pollOnce();
    } catch (err) {
      this.logger.warn(`入网轮询失败: ${(err as Error).message}`);
    }
  }

  private async ensurePlatformKeys(): Promise<void> {
    if (
      process.env.CONNECTOR_PLATFORM_CA_PUBKEY &&
      process.env.CONNECTOR_PLATFORM_NODE_PUBKEY &&
      process.env.CONNECTOR_REGISTRY_PUBKEY
    ) {
      return;
    }
    try {
      const res = await fetch(`${this.api()}/attestation/trust-anchor`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        caPublicKey?: string;
        platformNodePublicKey?: string;
        registryPublicKey?: string;
      };
      const state = {
        ...readState(),
        caPublicKey: body.caPublicKey,
        platformNodePublicKey: body.platformNodePublicKey,
        registryPublicKey: body.registryPublicKey,
      };
      writeState(state);
      applyStateToEnv(state);
    } catch (err) {
      this.logger.warn(`读取平台公钥失败: ${(err as Error).message}`);
    }
  }

  private api(): string {
    return (process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1').replace(/\/$/, '');
  }
}
