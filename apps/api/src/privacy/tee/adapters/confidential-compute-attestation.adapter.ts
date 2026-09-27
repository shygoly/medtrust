import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SoftwareAttestationProvider,
  verifyAttestationForC2,
  type AttestationReport,
} from "@medtrust/mdop";
import {
  resolveControlPlaneAttestation,
  TEE_ATTESTATION_REGISTRY,
  type ControlPlaneAttestationRegistry,
} from "./attestation-registry";

export interface ConfidentialComputeInstanceConfig {
  instance_type: string;
  region: string;
  image_id: string;
  security_group_id?: string;
}

export interface ConfidentialComputeInstance {
  instance_id: string;
  public_ip: string;
  status: "pending" | "running" | "stopped" | "terminated";
  created_at: Date;
}

/**
 * 控制面历史 TEE 通道的证明适配器（原 `AlibabaCloudSgxAdapter`）。
 *
 * 改名理由（D9）：硬件目标是海光 CSV / TDX / SEV-SNP（`TEE_KINDS`），
 * 不是 SGX；继续叫 SGX 会把未接入的链型说成已经接上。
 *
 * 证明类型与判据一律消费 `@medtrust/mdop`：
 *  - 报告形状 = `AttestationReport`
 *  - 校验 = `verifyAttestationForC2`（内部再走 `createAttestationVerifier` + `TrustedRoot`）
 *  - 信任根必须由 `TEE_ATTESTATION_REGISTRY` 注入；未注入即抛错
 *
 * 实例申请/传数仍是历史占位（改造通道，不删除）。不得表述为已具备远程证明。
 */
@Injectable()
export class ConfidentialComputeAttestationAdapter {
  private readonly logger = new Logger(
    ConfidentialComputeAttestationAdapter.name,
  );
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  private readonly region: string;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(TEE_ATTESTATION_REGISTRY)
    private readonly registry: ControlPlaneAttestationRegistry | null = null,
  ) {
    this.accessKeyId = this.configService.get<string>(
      "ALIBABA_CLOUD_ACCESS_KEY_ID",
    );
    this.accessKeySecret = this.configService.get<string>(
      "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    );
    this.region = this.configService.get<string>(
      "ALIBABA_CLOUD_REGION",
      "cn-hongkong",
    );
  }

  async provisionInstance(
    config: ConfidentialComputeInstanceConfig,
  ): Promise<ConfidentialComputeInstance> {
    try {
      this.logger.log(
        `Provisioning confidential-compute instance in region: ${config.region}`,
      );

      const instanceId = `i-cc-${Date.now()}`;
      const publicIp = `47.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      this.logger.log(`Instance provisioned (placeholder): ${instanceId}`);

      return {
        instance_id: instanceId,
        public_ip: publicIp,
        status: "running",
        created_at: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to provision instance: ${error.message}`);
      throw new Error(`Failed to provision instance: ${error.message}`);
    }
  }

  async getInstanceStatus(
    instanceId: string,
  ): Promise<ConfidentialComputeInstance["status"]> {
    try {
      this.logger.log(`Checking status for instance: ${instanceId}`);
      return "running";
    } catch (error) {
      this.logger.error(`Failed to get instance status: ${error.message}`);
      throw new Error(`Failed to get instance status: ${error.message}`);
    }
  }

  /**
   * 未注入厂商 quote 提供者时，只产出 software 级占位报告
   * （`SoftwareAttestationProvider`，C2 必拒）。这是 mdop 契约上的报告，
   * 不是历史 `{quote, signature, timestamp}` 本地形状。
   */
  async getAttestationReport(instanceId: string): Promise<AttestationReport> {
    this.logger.warn(
      `getAttestationReport(${instanceId}): 未接入厂商 quote，返回 software 级占位（C2 必拒）`,
    );
    return new SoftwareAttestationProvider({
      measurement: `sm3:${"0".repeat(64)}`,
    }).prove();
  }

  /**
   * 用 mdop 契约校验。成功则返回；失败抛 `MdopError`（错误码即拒绝理由）。
   *
   * 未注入信任根 / 策略 → `E_ATTESTATION_FAILED`（接缝抛错，对照 providers.ts）。
   * 软件级报告 → `verifyAttestationForC2` → `E_CAPABILITY_MISMATCH`。
   * 度量不在白名单 / TCB 过期 → 既有错误码。
   */
  verifyAttestation(report: AttestationReport): void {
    const { policy, verifier } = resolveControlPlaneAttestation(this.registry);
    verifyAttestationForC2({ report, policy, verifier });
  }

  async terminateInstance(instanceId: string): Promise<void> {
    try {
      this.logger.log(`Terminating instance: ${instanceId}`);
      this.logger.log(`Instance ${instanceId} terminated successfully`);
    } catch (error) {
      this.logger.error(`Failed to terminate instance: ${error.message}`);
      throw new Error(`Failed to terminate instance: ${error.message}`);
    }
  }

  async uploadEncryptedData(
    instanceId: string,
    data: Buffer,
    encryptionKey: string,
  ): Promise<string> {
    try {
      this.logger.log(`Uploading encrypted data to instance: ${instanceId}`);
      const dataPath = `/data/${Date.now()}.enc`;
      return dataPath;
    } catch (error) {
      this.logger.error(`Failed to upload encrypted data: ${error.message}`);
      throw new Error(`Failed to upload encrypted data: ${error.message}`);
    }
  }

  async downloadEncryptedResult(
    instanceId: string,
    resultPath: string,
  ): Promise<Buffer> {
    try {
      this.logger.log(
        `Downloading encrypted result from instance: ${instanceId}`,
      );
      return Buffer.from("mock-encrypted-result");
    } catch (error) {
      this.logger.error(
        `Failed to download encrypted result: ${error.message}`,
      );
      throw new Error(`Failed to download encrypted result: ${error.message}`);
    }
  }
}
