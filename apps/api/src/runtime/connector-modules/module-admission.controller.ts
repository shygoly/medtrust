// third-party-module-admission —— 控制面准入接口（task 6.1）。
//
// 源码提交 → 构建触发 → 审查状态 → 影子 → 吊销。对医院公开的只读视图
// (`GET modules/:sm3/public`) **不含源码**:保密提交只出 SM3 + 审查背书(design D6)。
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AdmissionTier, SourceLanguage } from "@medtrust/wasm-algorithms";
import type { ModuleAdmissionStatus } from "@medtrust/database";
import { ModuleAdmissionService } from "./module-admission.service";
import { CurrentSpace } from "../space-context/current-space.decorator";

@ApiTags("module-admission")
@Controller("module-admission")
export class ModuleAdmissionController {
  constructor(private readonly admission: ModuleAdmissionService) {}

  @Post("submissions")
  @ApiOperation({
    summary:
      "提交算法模块源码（只收 Rust / AssemblyScript；只交二进制在此即拒）",
  })
  submit(
    @Body()
    body: {
      analysisType: string;
      tier: AdmissionTier;
      language: SourceLanguage;
      submittedBy: string;
      sourceRef: string;
      confidential?: boolean;
      spaceId?: string;
    },
  ) {
    return this.admission.submit(body);
  }

  @Get("submissions")
  @ApiOperation({ summary: "列出准入记录（可按分析类型 / 状态过滤）" })
  list(
    @CurrentSpace() spaceId: string | undefined,
    @Query("analysisType") analysisType?: string,
    @Query("status") status?: ModuleAdmissionStatus,
  ) {
    return this.admission.list({ analysisType, status, spaceId });
  }

  @Get("submissions/:admissionId")
  @ApiOperation({ summary: "查准入状态（含五道闸各自的留痕）" })
  get(@Param("admissionId") admissionId: string) {
    return this.admission.get(admissionId);
  }

  @Post("submissions/:admissionId/attest-build")
  @ApiOperation({
    summary:
      "闸 2（生产路径）：提交 ≥2 份独立构建器的产物字节；平台自算 SM3、比对、过闸 1、CA 签名",
    description:
      "控制面**不编译**第三方代码（build.rs / proc-macro 是编译期执行点，且挂 docker.sock " +
      "等于把宿主 root 交给 api 容器）。构建在独立构建环境完成：" +
      "`node packages/wasm-algorithms/scripts/admit-cli.mjs --source <dir> " +
      "--analysis-type <t> --emit-base64`，把两台/两次独立构建器的输出交到这里。" +
      "平台不信任提交方声称的 SM3，一律自己重算。",
  })
  attestBuild(
    @Param("admissionId") admissionId: string,
    @Body()
    body: {
      reviewer: string;
      builds: Array<{
        builderId: string;
        wasmBase64: string;
        toolchain?: Record<string, unknown>;
        sourceGate?: Record<string, unknown>;
      }>;
    },
  ) {
    return this.admission.attestBuild(admissionId, body.reviewer, body.builds);
  }

  @Post("submissions/:admissionId/build")
  @ApiOperation({
    summary:
      "闸 2（**仅本地开发/单机 demo**）：由控制面自行触发构建；缺省禁用，需 MODULE_LOCAL_BUILD_ALLOWED=true",
  })
  build(
    @Param("admissionId") admissionId: string,
    @Body() body: { reviewer: string },
  ) {
    return this.admission.triggerBuild(admissionId, body.reviewer);
  }

  @Post("submissions/:admissionId/dynamic-gate")
  @ApiOperation({ summary: "闸 3：记录沙箱动态测试结果（任一不过即拒）" })
  dynamicGate(
    @Param("admissionId") admissionId: string,
    @Body()
    body: {
      consistency: boolean;
      determinism: boolean;
      resourceLimits: boolean;
      antiExfiltration: boolean;
      fuzz: boolean;
      detail?: Record<string, unknown>;
    },
  ) {
    return this.admission.recordDynamicGate(admissionId, body);
  }

  @Post("submissions/:admissionId/shadow")
  @ApiOperation({ summary: "闸 4：进入影子发布（只算不发结果）" })
  shadow(
    @Param("admissionId") admissionId: string,
    @Body() body: { providerId: string; startedAt?: string },
  ) {
    return this.admission.startShadow(admissionId, body);
  }

  @Post("submissions/:admissionId/shadow/conclude")
  @ApiOperation({
    summary: "闸 4：影子结论（干净才晋级 canary；不干净即拒，不得跳闸）",
  })
  concludeShadow(
    @Param("admissionId") admissionId: string,
    @Body() body: { clean: boolean; reviewedBy: string; detail?: string },
  ) {
    return this.admission.concludeShadow(admissionId, body);
  }

  @Post("submissions/:admissionId/promote")
  @ApiOperation({ summary: "canary → 全量" })
  promote(@Param("admissionId") admissionId: string) {
    return this.admission.promoteToActive(admissionId);
  }

  @Post("revocations/:sm3")
  @ApiOperation({
    summary: "闸 5：吊销模块（连接器下次运行即拒，且不回退到内置实现）",
  })
  revoke(
    @Param("sm3") sm3: string,
    @Body() body: { reason: string; revokedBy: string; detail?: string },
  ) {
    return this.admission.revoke(sm3, body);
  }

  @Get("revocations")
  @ApiOperation({ summary: "当前吊销名单（随长轮询批次下发给连接器）" })
  revocations(@CurrentSpace() spaceId: string | undefined) {
    return this.admission.revocationList(spaceId);
  }

  @Get("modules/:sm3/public")
  @ApiOperation({
    summary: "对医院公开的模块视图（SM3 + 准入层级 + 审查背书；不含源码）",
  })
  async publicView(@Param("sm3") sm3: string) {
    const view = await this.admission.publicView(sm3);
    if (!view) throw new NotFoundException("模块未入册");
    return view;
  }
}
