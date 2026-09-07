import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { XianHeaderService, XianHeaders } from "./xian-header.service";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianApiError } from "./xian-api-error";

@ApiTags("Xian Open API")
@Controller("open-api")
export class XianOpenApiController {
  private readonly logger = new Logger(XianOpenApiController.name);

  constructor(
    private readonly headers: XianHeaderService,
    private readonly service: XianOpenApiService,
  ) {}

  @Post("user/sync")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心用户同步（PDF §6）" })
  async userSync(@Body() body: any, @Headers() headers: XianHeaders) {
    let traceId: string | undefined;
    try {
      traceId = this.headers.validate(headers).traceId;
      return await this.service.userSync(body);
    } catch (e) {
      this.logError(e, traceId ?? this.headerValue(headers, "x-trace-id"));
      return this.toResponse(e);
    }
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心可信免登（PDF §7）" })
  async login(@Body() body: any, @Headers() headers: XianHeaders) {
    let traceId: string | undefined;
    try {
      traceId = this.headers.validate(headers).traceId;
      return await this.service.login(body);
    } catch (e) {
      this.logError(e, traceId ?? this.headerValue(headers, "x-trace-id"));
      return this.toResponse(e);
    }
  }

  private toResponse(e: unknown) {
    if (e instanceof XianApiError) {
      return { code: e.code, message: e.message };
    }
    return { code: "SYSTEM_ERROR", message: "system error" };
  }

  private logError(e: unknown, traceId: string | undefined) {
    const id = traceId || "unknown";
    if (e instanceof Error) {
      this.logger.error(`${e.message} traceId=${id}`, e.stack);
      return;
    }
    this.logger.error(`system error: ${String(e)} traceId=${id}`);
  }

  private headerValue(headers: XianHeaders, name: string): string | undefined {
    const v = headers[name];
    const raw = String(Array.isArray(v) ? v[0] : (v ?? "")).trim();
    return raw || undefined;
  }
}
