import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { OrganizationService } from "./organization.service";
import { UploadService } from "./upload.service";
import { SaveCertificationDto } from "./dto/save-certification.dto";
import { ReviewCertificationDto } from "./dto/review-certification.dto";
import { UploadDto } from "./dto/upload.dto";
import { IssueUserCaDto } from "./dto/issue-user-ca.dto";

// P1-4:机构认证 API。用户侧为 /account/certification;
// 运营审核侧为 /admin/certifications(operator 门禁)。
@ApiTags("organization")
@ApiBearerAuth()
@Controller()
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly uploadService: UploadService,
  ) {}

  @Post("account/upload")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "上传证照/LOGO(P1-6)" })
  upload(@Request() req: any, @Body() dto: UploadDto) {
    return this.uploadService.save(req.user.userId, dto);
  }

  @Get("account/files")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "读取已上传证照/LOGO(P1-6)" })
  async file(
    @Request() req: any,
    @Query("key") key: string,
    @Res() res: any,
  ) {
    const file = await this.uploadService.getFile(req.user.userId, key);
    res.set({
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
    });
    res.send(file.body);
  }

  @Get("account/certification")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "我的机构认证申请" })
  getMine(@Request() req: any) {
    return this.organizationService.getMyCertification(req.user.userId);
  }

  @Put("account/certification")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "保存/提交机构认证申请" })
  saveMine(@Request() req: any, @Body() dto: SaveCertificationDto) {
    return this.organizationService.saveCertification(req.user.userId, dto);
  }

  @Post("account/certification/ca")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "生成用户 CA 身份凭证(P1-7)" })
  issueCa(@Request() req: any, @Body() dto: IssueUserCaDto) {
    return this.organizationService.issueUserCa(
      req.user.userId,
      dto.identityName,
      dto.publicKey,
    );
  }

  @Post("account/certification/ca/revoke")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "作废用户 CA 身份凭证(P1-7,换机重发)" })
  revokeCa(@Request() req: any) {
    return this.organizationService.revokeUserCa(req.user.userId);
  }

  @Get("admin/certifications")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  @ApiOperation({ summary: "机构认证申请列表(运营方)" })
  list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.organizationService.listCertifications({
      status,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  @Post("admin/certifications/:id/review")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  @ApiOperation({ summary: "审核机构认证申请(通过/驳回)" })
  review(
    @Param("id") id: string,
    @Request() req: any,
    @Body() dto: ReviewCertificationDto,
  ) {
    return this.organizationService.reviewCertification(
      id,
      req.user.userId,
      dto,
    );
  }
}
