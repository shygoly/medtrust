import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom, timeout, catchError } from "rxjs";

export interface FateFlowJobConfig {
  job_type: "train" | "predict";
  algorithm: string;
  participants: Array<{
    party_id: number;
    role: "guest" | "host" | "arbiter";
    endpoint: string;
  }>;
  training_params?: {
    epochs?: number;
    batch_size?: number;
    learning_rate?: number;
  };
  dataset_refs?: Array<{
    party_id: number;
    dataset_id: string;
    features: string[];
  }>;
}

export interface FateFlowJobStatus {
  job_id: string;
  status: "pending" | "running" | "success" | "failed" | "canceled";
  progress: number;
  current_epoch?: number;
  total_epochs?: number;
  error_message?: string;
}

export interface FateFlowJobMetrics {
  accuracy?: number;
  loss?: number;
  auc?: number;
  [key: string]: any;
}

@Injectable()
export class FateFlowAdapter {
  private readonly logger = new Logger(FateFlowAdapter.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.baseUrl = this.configService.get<string>("FATE_FLOW_URL");
    this.timeoutMs = this.configService.get<number>(
      "FATE_FLOW_TIMEOUT",
      300000,
    );
  }

  async submitJob(config: FateFlowJobConfig): Promise<string> {
    try {
      this.logger.log(`Submitting FATE Flow job: ${config.algorithm}`);

      const response = await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/v1/job/submit`, {
            job_type: config.job_type,
            algorithm: config.algorithm,
            initiator: {
              party_id: config.participants[0].party_id,
              role: config.participants[0].role,
            },
            job_parameters: {
              common: config.training_params || {},
            },
            role: this.buildRoleConfig(config.participants),
            dsl: this.buildDSL(config),
          })
          .pipe(
            timeout(this.timeoutMs),
            catchError((error) => {
              this.logger.error(
                `Failed to submit FATE Flow job: ${error.message}`,
              );
              throw error;
            }),
          ),
      );

      const jobId = response.data.jobId || response.data.job_id;
      this.logger.log(`FATE Flow job submitted successfully: ${jobId}`);
      return jobId;
    } catch (error) {
      this.logger.error(`FATE Flow job submission failed: ${error.message}`);
      throw new Error(`Failed to submit FATE Flow job: ${error.message}`);
    }
  }

  async getJobStatus(jobId: string): Promise<FateFlowJobStatus> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/v1/job/query`, {
            job_id: jobId,
          })
          .pipe(
            timeout(30000),
            catchError((error) => {
              this.logger.error(
                `Failed to query FATE Flow job status: ${error.message}`,
              );
              throw error;
            }),
          ),
      );

      const data = response.data.data || response.data;
      return {
        job_id: jobId,
        status: this.mapFateStatus(data.f_status || data.status),
        progress: data.progress || 0,
        current_epoch: data.current_epoch,
        total_epochs: data.total_epochs,
        error_message: data.error_message,
      };
    } catch (error) {
      this.logger.error(`Failed to get FATE Flow job status: ${error.message}`);
      throw new Error(`Failed to get job status: ${error.message}`);
    }
  }

  async getJobMetrics(jobId: string): Promise<FateFlowJobMetrics> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/v1/tracking/component/metrics`, {
            job_id: jobId,
          })
          .pipe(
            timeout(30000),
            catchError((error) => {
              this.logger.error(
                `Failed to get FATE Flow job metrics: ${error.message}`,
              );
              throw error;
            }),
          ),
      );

      return response.data.data || {};
    } catch (error) {
      this.logger.error(
        `Failed to get FATE Flow job metrics: ${error.message}`,
      );
      return {};
    }
  }

  async downloadModel(jobId: string): Promise<Buffer> {
    try {
      this.logger.log(`Downloading model for job: ${jobId}`);

      const response = await firstValueFrom(
        this.httpService
          .post(
            `${this.baseUrl}/v1/model/download`,
            {
              job_id: jobId,
            },
            {
              responseType: "arraybuffer",
            },
          )
          .pipe(
            timeout(60000),
            catchError((error) => {
              this.logger.error(`Failed to download model: ${error.message}`);
              throw error;
            }),
          ),
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Failed to download model: ${error.message}`);
      throw new Error(`Failed to download model: ${error.message}`);
    }
  }

  async stopJob(jobId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/v1/job/stop`, {
            job_id: jobId,
          })
          .pipe(
            timeout(30000),
            catchError((error) => {
              this.logger.error(
                `Failed to stop FATE Flow job: ${error.message}`,
              );
              throw error;
            }),
          ),
      );

      this.logger.log(`FATE Flow job stopped: ${jobId}`);
    } catch (error) {
      this.logger.error(`Failed to stop job: ${error.message}`);
      throw new Error(`Failed to stop job: ${error.message}`);
    }
  }

  private mapFateStatus(fateStatus: string): FateFlowJobStatus["status"] {
    const statusMap: Record<string, FateFlowJobStatus["status"]> = {
      waiting: "pending",
      ready: "pending",
      running: "running",
      success: "success",
      complete: "success",
      failed: "failed",
      canceled: "canceled",
      timeout: "failed",
    };

    return statusMap[fateStatus?.toLowerCase()] || "pending";
  }

  private buildRoleConfig(participants: FateFlowJobConfig["participants"]) {
    const roleConfig: Record<string, any[]> = {};

    for (const participant of participants) {
      if (!roleConfig[participant.role]) {
        roleConfig[participant.role] = [];
      }
      roleConfig[participant.role].push(participant.party_id);
    }

    return roleConfig;
  }

  private buildDSL(config: FateFlowJobConfig): any {
    // Build FATE DSL (Domain Specific Language) configuration
    // This is a simplified version - actual DSL depends on algorithm
    return {
      components: {
        reader_0: {
          module: "Reader",
          output: {
            data: ["data"],
          },
        },
        dataio_0: {
          module: "DataIO",
          input: {
            data: {
              data: ["reader_0.data"],
            },
          },
          output: {
            data: ["train"],
            model: ["dataio"],
          },
        },
        [config.algorithm]: {
          module: this.getModuleName(config.algorithm),
          input: {
            data: {
              train_data: ["dataio_0.train"],
            },
          },
          output: {
            data: ["predict"],
            model: ["model"],
          },
        },
      },
    };
  }

  private getModuleName(algorithm: string): string {
    const moduleMap: Record<string, string> = {
      logistic_regression: "HeteroLR",
      neural_network: "HeteroNN",
      secure_boost: "HeteroSecureBoost",
    };

    return moduleMap[algorithm] || "HeteroLR";
  }
}
