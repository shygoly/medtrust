import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";

/**
 * Flower Error Handler
 * Centralized error handling for Flower integration
 */
@Injectable()
export class FlowerErrorHandler {
  private readonly logger = new Logger(FlowerErrorHandler.name);

  /**
   * Handle Flower client errors
   */
  handleClientError(error: Error, context: string): HttpException {
    this.logger.error(
      `Flower error in ${context}: ${error.message}`,
      error.stack,
    );

    // Connection errors
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("unreachable")
    ) {
      return new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: "Flower server is unreachable",
          error: "Service Unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Timeout errors
    if (
      error.message.includes("timeout") ||
      error.message.includes("ETIMEDOUT")
    ) {
      return new HttpException(
        {
          statusCode: HttpStatus.REQUEST_TIMEOUT,
          message: "Request to Flower server timed out",
          error: "Request Timeout",
        },
        HttpStatus.REQUEST_TIMEOUT,
      );
    }

    // Task not found
    if (error.message.includes("not found") || error.message.includes("404")) {
      return new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: "Task not found on Flower server",
          error: "Not Found",
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Authentication errors
    if (
      error.message.includes("unauthorized") ||
      error.message.includes("401")
    ) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: "Authentication failed with Flower server",
          error: "Unauthorized",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Connection pool exhausted
    if (error.message.includes("pool") || error.message.includes("capacity")) {
      return new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many concurrent requests to Flower server",
          error: "Too Many Requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Default server error
    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: `Flower server error: ${error.message}`,
        error: "Internal Server Error",
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Handle webhook validation errors
   */
  handleWebhookError(error: Error): HttpException {
    this.logger.error(`Webhook error: ${error.message}`);

    return new HttpException(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: "Invalid webhook signature",
        error: "Unauthorized",
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Handle task validation errors
   */
  handleTaskValidationError(error: Error): HttpException {
    this.logger.error(`Task validation error: ${error.message}`);

    return new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Invalid task configuration: ${error.message}`,
        error: "Bad Request",
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Log error for debugging
   */
  logError(error: Error, metadata?: Record<string, any>): void {
    this.logger.error({
      message: error.message,
      stack: error.stack,
      ...metadata,
    });
  }

  /**
   * Log warning
   */
  logWarning(message: string, metadata?: Record<string, any>): void {
    this.logger.warn({
      message,
      ...metadata,
    });
  }
}
