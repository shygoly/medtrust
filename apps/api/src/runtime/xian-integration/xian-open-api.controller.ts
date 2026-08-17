import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { XianHeaderService, XianHeaders } from "./xian-header.service";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianApiError } from "./xian-api-error";

@ApiTags("Xian Open API")
@Controller("open-api")
export class XianOpenApiController {
  constructor(
    private readonly headers: XianHeaderService,
    private readonly service: XianOpenApiService,
  ) {}

  @Post("user/sync")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心用户同步（PDF §6）" })
  async userSync(@Body() body: any, @Headers() headers: XianHeaders) {
    try {
      this.headers.validate(headers);
      return await this.service.userSync(body);
    } catch (e) {
      return this.toResponse(e);
    }
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "西安节点能力中心可信免登（PDF §7）" })
  async login(@Body() body: any, @Headers() headers: XianHeaders) {
    try {
      this.headers.validate(headers);
      return await this.service.login(body);
    } catch (e) {
      return this.toResponse(e);
    }
  }

  private toResponse(e: unknown) {
    if (e instanceof XianApiError) {
      return { code: e.code, message: e.message };
    }
    return { code: "SYSTEM_ERROR", message: "system error" };
  }
}
