import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AccountService } from "./account.service";

// P1-11:用户中心「我的收藏」。全部端点登录后访问。
@ApiTags("account")
@ApiBearerAuth()
@Controller("account")
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get("favorites")
  @ApiOperation({ summary: "我的收藏列表" })
  list(@Request() req: any) {
    return this.accountService.listFavorites(req.user.userId);
  }

  @Post("favorites/:productId")
  @ApiOperation({ summary: "收藏数据产品" })
  add(@Request() req: any, @Param("productId") productId: string) {
    return this.accountService.addFavorite(req.user.userId, productId);
  }

  @Delete("favorites/:productId")
  @ApiOperation({ summary: "取消收藏" })
  remove(@Request() req: any, @Param("productId") productId: string) {
    return this.accountService.removeFavorite(req.user.userId, productId);
  }
}
