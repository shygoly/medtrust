import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { PortalService } from "./portal.service";

// P1-10:公开门户端点(无 JWT 守卫,访客可浏览)。仅暴露元数据。
@ApiTags("public")
@Controller("public")
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get("catalog")
  @ApiOperation({ summary: "公开数据产品目录(元数据)" })
  catalog() {
    return this.portalService.listProducts();
  }

  @Get("institutions")
  @ApiOperation({ summary: "公开机构大厅(参与方)" })
  institutions() {
    return this.portalService.listInstitutions();
  }
}
