import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface SgxInstanceConfig {
  instance_type: string;
  region: string;
  image_id: string;
  security_group_id?: string;
}

export interface SgxInstance {
  instance_id: string;
  public_ip: string;
  status: "pending" | "running" | "stopped" | "terminated";
  created_at: Date;
}

/**
 * 本结构只是历史 SGX mock 的占位形状，**不是** `packages/mdop` 的
 * `AttestationReport`，也不是厂商 quote。字段可被填入，但未经任何证明根校验。
 */
export interface AttestationReport {
  quote: string;
  report_data: string;
  signature: string;
  timestamp: Date;
}

/**
 * 控制面历史通道：阿里云 SGX 适配器。
 *
 * 未接入真实证明校验，**不得**被表述为已具备 TEE / 远程证明。
 * `verifyAttestation` 恒判失败（返回 false）。硬件目标按 D9 是海光 CSV（非 SGX）；
 * 本通道与 `packages/mdop` 的证明契约是两套并存，是否删除或改造见 T2b（产品决定）。
 */
@Injectable()
export class AlibabaCloudSgxAdapter {
  private readonly logger = new Logger(AlibabaCloudSgxAdapter.name);
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
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

  async provisionInstance(config: SgxInstanceConfig): Promise<SgxInstance> {
    try {
      this.logger.log(`Provisioning SGX instance in region: ${config.region}`);

      // Mock implementation - actual implementation would use @alicloud/ecs20140526
      // const client = new EcsClient({
      //   accessKeyId: this.accessKeyId,
      //   accessKeySecret: this.accessKeySecret,
      //   endpoint: `https://ecs.${config.region}.aliyuncs.com`,
      // });

      // For now, return mock data
      const instanceId = `i-sgx-${Date.now()}`;
      const publicIp = `47.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      this.logger.log(`SGX instance provisioned: ${instanceId}`);

      return {
        instance_id: instanceId,
        public_ip: publicIp,
        status: "running",
        created_at: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to provision SGX instance: ${error.message}`);
      throw new Error(`Failed to provision SGX instance: ${error.message}`);
    }
  }

  async getInstanceStatus(instanceId: string): Promise<SgxInstance["status"]> {
    try {
      // Mock implementation
      this.logger.log(`Checking status for instance: ${instanceId}`);
      return "running";
    } catch (error) {
      this.logger.error(`Failed to get instance status: ${error.message}`);
      throw new Error(`Failed to get instance status: ${error.message}`);
    }
  }

  /**
   * 返回占位报告（含历史 `mock-sgx-quote` 字面量）。这不是厂商 quote，
   * 不得当作远程证明。真实校验未接入，见 `verifyAttestation`。
   */
  async getAttestationReport(instanceId: string): Promise<AttestationReport> {
    try {
      this.logger.warn(
        `getAttestationReport(${instanceId}): 未接入真实证明，返回占位 mock（非厂商 quote）`,
      );

      return {
        quote: Buffer.from("mock-sgx-quote").toString("base64"),
        report_data: Buffer.from("mock-report-data").toString("base64"),
        signature: Buffer.from("mock-signature").toString("base64"),
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to get attestation report: ${error.message}`);
      throw new Error(`Failed to get attestation report: ${error.message}`);
    }
  }

  /**
   * 未接入真实证明校验，恒判失败。
   *
   * 选返回 `false` 而不抛错：方法契约是 `Promise<boolean>`，
   * `TeeService.getAttestation` 把返回值写入 `attestationValid` / `verified`
   * 交给调用方；返回 false 让读路径如实给出「未验证」（CTL-09），
   * 且 `submitComputation` 已对 `!attestationValid` fail-closed。
   * 抛错会把「未接入」伪装成 500 传输故障，调用方可能重试。
   * 不得保留任何无条件放行路径。
   */
  async verifyAttestation(_report: AttestationReport): Promise<boolean> {
    this.logger.warn(
      "verifyAttestation: 未接入真实证明校验，恒判失败（CTL-09 / P-CTL-8）",
    );
    return false;
  }

  async terminateInstance(instanceId: string): Promise<void> {
    try {
      this.logger.log(`Terminating SGX instance: ${instanceId}`);

      // Mock implementation
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

      // Mock implementation - actual implementation would:
      // 1. Establish secure channel with SGX enclave
      // 2. Upload encrypted data
      // 3. Return data path/reference

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

      // Mock implementation
      return Buffer.from("mock-encrypted-result");
    } catch (error) {
      this.logger.error(
        `Failed to download encrypted result: ${error.message}`,
      );
      throw new Error(`Failed to download encrypted result: ${error.message}`);
    }
  }
}
