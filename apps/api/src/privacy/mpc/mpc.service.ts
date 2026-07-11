import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MpcSession, MpcSessionStatus } from "@medtrust/database";
import { MpSpdzAdapter } from "./adapters/mp-spdz.adapter";
import {
  CreateMpcSessionDto,
  SubmitShareDto,
  MpcSessionResponseDto,
} from "./dto/mpc-session.dto";
import { v4 as uuidv4 } from "uuid";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class MpcService {
  private readonly logger = new Logger(MpcService.name);
  private readonly sessionShares = new Map<string, Map<number, number>>();

  constructor(
    @InjectRepository(MpcSession)
    private readonly mpcSessionRepository: Repository<MpcSession>,
    private readonly mpSpdzAdapter: MpSpdzAdapter,
  ) {}

  async createSession(
    tenantId: number,
    dto: CreateMpcSessionDto,
  ): Promise<MpcSessionResponseDto> {
    // Validate participants
    if (dto.participants.length < 2) {
      throw new BadRequestException("At least 2 participants required for MPC");
    }

    const sessionId = uuidv4();
    const timeoutSeconds = dto.timeout_seconds || 300;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

    // Create session record
    const session = this.mpcSessionRepository.create({
      tenantId,
      sessionId,
      name: dto.name,
      description: dto.description,
      computationType: dto.computation_type,
      participants: dto.participants.map((p) => ({
        ...p,
        share_submitted: false,
      })),
      totalParticipants: dto.participants.length,
      sharesReceived: 0,
      status: MpcSessionStatus.WAITING_FOR_SHARES,
      timeoutSeconds,
      expiresAt,
    });

    await this.mpcSessionRepository.save(session);

    // Initialize shares map
    this.sessionShares.set(sessionId, new Map());

    this.logger.log(`MPC session created: ${sessionId}`);
    return this.toResponseDto(session);
  }

  async submitShare(
    tenantId: number,
    sessionId: number,
    dto: SubmitShareDto,
  ): Promise<MpcSessionResponseDto> {
    const session = await this.mpcSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`MPC session ${sessionId} not found`);
    }

    // Check if session expired
    if (session.expiresAt && new Date() > session.expiresAt) {
      session.status = MpcSessionStatus.TIMEOUT;
      await this.mpcSessionRepository.save(session);
      throw new BadRequestException("Session has expired");
    }

    // Check if session is in correct status
    if (session.status !== MpcSessionStatus.WAITING_FOR_SHARES) {
      throw new BadRequestException(
        `Cannot submit share - session status is ${session.status}`,
      );
    }

    // Verify party_id is valid participant
    const participant = session.participants.find(
      (p) => p.party_id === dto.party_id,
    );
    if (!participant) {
      throw new ForbiddenException("Party ID not registered for this session");
    }

    // Check if share already submitted
    if (participant.share_submitted) {
      throw new BadRequestException("Share already submitted for this party");
    }

    // Store share
    const shares = this.sessionShares.get(session.sessionId) || new Map();
    shares.set(dto.party_id, dto.value);
    this.sessionShares.set(session.sessionId, shares);

    // Update participant status
    participant.share_submitted = true;
    session.sharesReceived += 1;

    await this.mpcSessionRepository.save(session);

    // If all shares received, trigger computation
    if (session.sharesReceived === session.totalParticipants) {
      this.computeResult(session.id).catch((error) => {
        this.logger.error(
          `Failed to compute result for session ${session.id}: ${error.message}`,
        );
      });
    }

    return this.toResponseDto(session);
  }

  async getSession(
    tenantId: number,
    sessionId: number,
  ): Promise<MpcSessionResponseDto> {
    const session = await this.mpcSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`MPC session ${sessionId} not found`);
    }

    // Check if user is a participant
    const isParticipant = session.participants.some(
      (p) => p.tenant_id === tenantId,
    );
    if (!isParticipant && session.tenantId !== tenantId) {
      throw new ForbiddenException("Not authorized to view this session");
    }

    return this.toResponseDto(session);
  }

  async cancelSession(tenantId: number, sessionId: number): Promise<void> {
    const session = await this.mpcSessionRepository.findOne({
      where: { id: sessionId, tenantId },
    });

    if (!session) {
      throw new NotFoundException(`MPC session ${sessionId} not found`);
    }

    if (session.status === MpcSessionStatus.COMPLETED) {
      throw new BadRequestException("Cannot cancel completed session");
    }

    session.status = MpcSessionStatus.CANCELLED;
    await this.mpcSessionRepository.save(session);

    // Clean up shares
    this.sessionShares.delete(session.sessionId);
  }

  private async computeResult(sessionId: number): Promise<void> {
    const session = await this.mpcSessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) return;

    try {
      session.status = MpcSessionStatus.COMPUTING;
      session.startedAt = new Date();
      await this.mpcSessionRepository.save(session);

      const shares = this.sessionShares.get(session.sessionId);
      if (!shares || shares.size !== session.totalParticipants) {
        throw new Error("Not all shares available");
      }

      const sharesArray = Array.from(shares.entries()).map(
        ([party_id, value]) => ({
          party_id,
          value,
        }),
      );

      let result: number;
      const startTime = Date.now();

      if (session.computationType === "secure_sum") {
        const computeResult = await this.mpSpdzAdapter.computeSum({
          session_id: session.sessionId,
          shares: sharesArray,
        });
        result = computeResult.result;
      } else if (session.computationType === "secure_mean") {
        const computeResult = await this.mpSpdzAdapter.computeMean({
          session_id: session.sessionId,
          shares: sharesArray,
        });
        result = computeResult.result;
      } else {
        throw new Error(
          `Unsupported computation type: ${session.computationType}`,
        );
      }

      const computationTimeMs = Date.now() - startTime;

      session.result = result;
      session.resultMetadata = {
        computation_time_ms: computationTimeMs,
      };
      session.status = MpcSessionStatus.COMPLETED;
      session.completedAt = new Date();

      await this.mpcSessionRepository.save(session);

      // Clean up shares
      this.sessionShares.delete(session.sessionId);

      this.logger.log(
        `MPC session ${sessionId} completed with result: ${result}`,
      );
    } catch (error) {
      session.status = MpcSessionStatus.FAILED;
      session.errorMessage = error.message;
      session.completedAt = new Date();
      await this.mpcSessionRepository.save(session);

      this.logger.error(`MPC session ${sessionId} failed: ${error.message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkExpiredSessions(): Promise<void> {
    const expiredSessions = await this.mpcSessionRepository
      .createQueryBuilder("session")
      .where("session.status = :status", {
        status: MpcSessionStatus.WAITING_FOR_SHARES,
      })
      .andWhere("session.expires_at < :now", { now: new Date() })
      .getMany();

    for (const session of expiredSessions) {
      session.status = MpcSessionStatus.TIMEOUT;
      await this.mpcSessionRepository.save(session);
      this.sessionShares.delete(session.sessionId);
      this.logger.log(`MPC session ${session.id} timed out`);
    }
  }

  private toResponseDto(session: MpcSession): MpcSessionResponseDto {
    return {
      id: session.id,
      session_id: session.sessionId,
      name: session.name,
      status: session.status,
      computation_type: session.computationType,
      total_participants: session.totalParticipants,
      shares_received: session.sharesReceived,
      result: session.result ? Number(session.result) : undefined,
      error_message: session.errorMessage,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      completed_at: session.completedAt,
    };
  }
}
