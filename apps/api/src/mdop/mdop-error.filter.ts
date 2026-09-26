import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { MdopError } from "@medtrust/mdop";

/**
 * 把 `MdopError` 映射成 **400 + 错误码**（而不是 500「内部错误」）。
 *
 * MDOP 的错误码是协议的一部分（`E_*` 带可重试标记），客户端要按码决策；
 * 让它们以 500 冒出去既丢信息，也会误导调用方以为平台崩了。
 */
@Catch(MdopError)
export class MdopErrorFilter implements ExceptionFilter {
  catch(exception: MdopError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const reject = exception.toRejectReason();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      code: exception.code,
      retryable: exception.retryable,
      message: reject.message,
      ...(reject.edge ? { edge: reject.edge } : {}),
    });
  }
}
