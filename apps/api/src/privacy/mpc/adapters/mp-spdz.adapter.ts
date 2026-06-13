import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';

export interface MpcComputeRequest {
  session_id: string;
  shares: Array<{
    party_id: number;
    value: number;
  }>;
}

export interface MpcComputeResult {
  session_id: string;
  result: number;
  computation: string;
}

@Injectable()
export class MpSpdzAdapter {
  private readonly logger = new Logger(MpSpdzAdapter.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.baseUrl = this.configService.get<string>('MP_SPDZ_GATEWAY_URL');
    this.timeoutMs = this.configService.get<number>('MP_SPDZ_TIMEOUT', 60000);
  }

  async computeSum(request: MpcComputeRequest): Promise<MpcComputeResult> {
    try {
      this.logger.log(`Computing secure sum for session: ${request.session_id}`);

      const response = await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/compute/sum`, request)
          .pipe(
            timeout(this.timeoutMs),
            catchError((error) => {
              this.logger.error(`Failed to compute secure sum: ${error.message}`);
              throw error;
            }),
          ),
      );

      this.logger.log(`Secure sum computed successfully: ${response.data.result}`);
      return response.data;
    } catch (error) {
      this.logger.error(`MP-SPDZ secure sum failed: ${error.message}`);
      throw new Error(`Failed to compute secure sum: ${error.message}`);
    }
  }

  async computeMean(request: MpcComputeRequest): Promise<MpcComputeResult> {
    try {
      this.logger.log(`Computing secure mean for session: ${request.session_id}`);

      const response = await firstValueFrom(
        this.httpService
          .post(`${this.baseUrl}/compute/mean`, request)
          .pipe(
            timeout(this.timeoutMs),
            catchError((error) => {
              this.logger.error(`Failed to compute secure mean: ${error.message}`);
              throw error;
            }),
          ),
      );

      this.logger.log(`Secure mean computed successfully: ${response.data.result}`);
      return response.data;
    } catch (error) {
      this.logger.error(`MP-SPDZ secure mean failed: ${error.message}`);
      throw new Error(`Failed to compute secure mean: ${error.message}`);
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get(`${this.baseUrl}/health`)
          .pipe(
            timeout(5000),
            catchError(() => {
              return of({ data: { status: 'unhealthy' } });
            }),
          ),
      );

      return response.data?.status === 'healthy';
    } catch (error) {
      this.logger.warn(`MP-SPDZ gateway health check failed: ${error.message}`);
      return false;
    }
  }
}
