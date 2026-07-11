import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from "@nestjs/swagger";
import { createHmac } from "crypto";
import { FlowerTaskService } from "./flower-task.service";
import { FlowerConfigService } from "./flower-config.service";
import { WebhookPayload, FLTaskStatus } from "./types";

/**
 * Flower Webhook Controller
 * Handles webhook notifications from Flower server
 */
@ApiTags("flower-webhook")
@Controller("api/v1/flower/webhook")
export class FlowerWebhookController {
  private readonly logger = new Logger(FlowerWebhookController.name);

  constructor(
    private readonly flowerTaskService: FlowerTaskService,
    private readonly flowerConfig: FlowerConfigService,
  ) {}

  /**
   * Receive webhook from Flower server
   * POST /api/v1/flower/webhook
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "接收 Flower Webhook 通知",
    description: "接收来自 Flower 服务器的任务状态更新通知",
  })
  @ApiHeader({
    name: "x-signature",
    description: "Webhook 签名 (HMAC-SHA256)",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: "Webhook 处理成功",
  })
  @ApiResponse({
    status: 401,
    description: "签名验证失败",
  })
  async handleWebhook(
    @Body() payload: WebhookPayload,
    @Headers("x-signature") signature: string,
    @Headers("x-event-type") eventType: string,
  ): Promise<{ received: boolean }> {
    this.logger.log(
      `Received webhook: ${payload.event} for task ${payload.taskId}`,
    );

    // Validate webhook signature
    if (!this.validateWebhookSignature(payload, signature)) {
      this.logger.warn(`Invalid webhook signature for task ${payload.taskId}`);
      throw new UnauthorizedException("Invalid webhook signature");
    }

    try {
      // Process webhook based on event type
      switch (payload.event) {
        case "task.created":
          this.logger.debug(`Task ${payload.taskId} created`);
          break;

        case "task.started":
          this.logger.debug(`Task ${payload.taskId} started`);
          await this.flowerTaskService.updateTaskFromWebhook(
            payload.taskId,
            FLTaskStatus.RUNNING,
            payload.data,
          );
          break;

        case "task.progress":
          this.logger.debug(`Task ${payload.taskId} progress update`);
          await this.flowerTaskService.updateTaskFromWebhook(
            payload.taskId,
            FLTaskStatus.RUNNING,
            payload.data,
          );
          break;

        case "task.completed":
          this.logger.log(`Task ${payload.taskId} completed`);
          await this.flowerTaskService.updateTaskFromWebhook(
            payload.taskId,
            FLTaskStatus.COMPLETED,
            payload.data,
          );
          // Trigger result fetch
          break;

        case "task.failed":
          this.logger.error(
            `Task ${payload.taskId} failed: ${payload.data?.errorMessage}`,
          );
          await this.flowerTaskService.updateTaskFromWebhook(
            payload.taskId,
            FLTaskStatus.FAILED,
            payload.data,
          );
          break;

        case "task.cancelled":
          this.logger.log(`Task ${payload.taskId} cancelled`);
          await this.flowerTaskService.updateTaskFromWebhook(
            payload.taskId,
            FLTaskStatus.CANCELLED,
            payload.data,
          );
          break;

        default:
          this.logger.warn(`Unknown webhook event type: ${payload.event}`);
      }

      // TODO: Send WebSocket notification to frontend
      // this.websocketGateway.notifyTaskUpdate(payload.taskId, payload);

      return { received: true };
    } catch (error) {
      this.logger.error(`Failed to process webhook: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate webhook signature using HMAC-SHA256
   */
  private validateWebhookSignature(
    payload: WebhookPayload,
    signature: string,
  ): boolean {
    if (!signature) {
      this.logger.warn("Missing webhook signature");
      return false;
    }

    try {
      const secret = this.flowerConfig.getWebhookSecret();
      const payloadString = JSON.stringify(payload);
      const expectedSignature = createHmac("sha256", secret)
        .update(payloadString)
        .digest("hex");

      // Use timing-safe comparison to prevent timing attacks
      const provided = Buffer.from(signature);
      const expected = Buffer.from(expectedSignature);

      if (provided.length !== expected.length) {
        return false;
      }

      return provided.equals(expected);
    } catch (error) {
      this.logger.error(`Signature validation error: ${error.message}`);
      return false;
    }
  }
}
