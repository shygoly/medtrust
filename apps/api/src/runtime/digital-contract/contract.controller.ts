import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ContractService, ContractApplyInput } from "./contract.service";
import { AttestationService } from "./attestation.service";
import { ApproveContractDto } from "./dto/approve-contract.dto";
import { ApproveDraftDto } from "./dto/approve-draft.dto";
import { RequestContractDto } from "./dto/request-contract.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { MdopContractService } from "./mdop-contract.service";

// 新控制面数字合约端点。前端将从旧 /access-requests 切到这里(8.2 切换前置)。
// 授权 = 批准生成数字合约,取代一次性审批。
@ApiTags("contracts")
@ApiBearerAuth()
@Controller("contracts")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly attestation: AttestationService,
    @Optional() private readonly mdop?: MdopContractService,
  ) {}

  @Get()
  list(@CurrentUser() user: { role?: string; participantId?: string }) {
    return this.contracts.list({
      role: user?.role,
      participantId: user?.participantId,
    });
  }

  /** 药企发起数字合约申请（draft） */
  @Post("requests")
  @ParticipantRoles("consumer")
  request(
    @Body() dto: RequestContractDto,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.contracts.request(dto as ContractApplyInput, consumerId);
  }

  /** 医院直接签发（跳过申请，active） */
  @Post()
  @ParticipantRoles("provider")
  approve(@Body() dto: ApproveContractDto) {
    return this.contracts.approve(dto);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const contract = await this.contracts.get(id);
    if (!contract) throw new NotFoundException("数字合约不存在");
    return contract;
  }

  /** 医院审批药企申请 → 签发 active 合约 */
  @Post(":id/approve")
  @ParticipantRoles("provider")
  approveDraft(
    @Param("id") id: string,
    @CurrentUser("participantId") providerId: string,
    @Body() dto?: ApproveDraftDto,
  ) {
    return this.contracts.approveDraft(
      id,
      providerId,
      dto?.pinnedModules,
      dto?.preReviewAck,
    );
  }

  /** 消费方确认规则知悉（8.1 真实性最小闭环，P0-7） */
  @Post(":id/acknowledge")
  @ParticipantRoles("consumer")
  acknowledge(
    @Param("id") id: string,
    @CurrentUser("participantId") consumerId: string,
  ) {
    return this.contracts.acknowledge(id, consumerId);
  }

  /** 医院驳回药企申请 */
  @Post(":id/reject")
  @ParticipantRoles("provider")
  rejectDraft(
    @Param("id") id: string,
    @CurrentUser("participantId") providerId: string,
  ) {
    return this.contracts.rejectDraft(id, providerId);
  }

  @Post(":id/revoke")
  @ParticipantRoles("provider")
  async revoke(
    @Param("id") id: string,
    @CurrentUser("participantId") providerId: string,
    @Body("reason") reason?: string,
  ) {
    await this.contracts.revoke(id, providerId, reason);
    return { id, status: "revoked", revokeReason: reason };
  }

  // P1-7:合约完整性校验——重算 canonical SM3 与存储哈希、链上回执三方比对。
  @Get(":id/integrity")
  async integrity(@Param("id") id: string) {
    return this.contracts.verifyIntegrity(id);
  }

  // ── MDOP 合约持有方签署（D-MDOP-4 / 任务 5.2）───────────────────────────────
  // 医院网页批准后由前端/工作流调用：生成条款 → 落发件箱 → 长轮询把 ContractOffer
  // 送给该院连接器。连接器本地确认后才用本院私钥签 ContractAgree。

  @Post(":id/mdop/offer")
  @ParticipantRoles("provider", "operator")
  async mdopOffer(
    @Param("id") id: string,
    @Body() opts: Record<string, unknown> = {},
  ) {
    return this.mdop.offer(id, opts as never);
  }

  @Get(":id/mdop")
  async mdopDescribe(@Param("id") id: string) {
    return this.mdop.describeForNode(id);
  }

  /**
   * 接收连接器的 `ContractAgree`。§7 的消息通道上线后，这条会由
   * `POST /api/v1/mdop/messages` 的信封分发调用；此处保留直连入口便于本地演练。
   */
  @Post("mdop/agree")
  async mdopAgree(
    @Body()
    body: {
      contractId?: string;
      canonical?: string;
      holderSignature?: string;
    },
  ) {
    if (!body.contractId || !body.canonical || !body.holderSignature) {
      throw new NotFoundException(
        "缺少 contractId / canonical / holderSignature",
      );
    }
    const row = await this.mdop.agree({
      contractId: body.contractId,
      canonical: body.canonical,
      holderSignature: body.holderSignature,
    });
    return { contractId: row.id, mdopStatus: row.mdopStatus };
  }

  @Post(":id/mdop/terminate")
  @ParticipantRoles("provider", "operator")
  async mdopTerminate(
    @Param("id") id: string,
    @Body("reason") reason?: string,
  ) {
    await this.mdop.terminate(id, reason ?? "平台终止");
    return { id, mdopStatus: "terminated" };
  }

  // 合约哈希上链存证
  @Post(":id/attest")
  async attest(@Param("id") id: string) {
    const contract = await this.contracts.get(id);
    if (!contract) throw new NotFoundException("数字合约不存在");
    const receipt = await this.attestation.attestContract(contract);
    // 回执回写合约表(与 P1-2 自动备案一致)
    await this.contracts.writeAttestationReceipt(
      id,
      receipt.txHash,
      receipt.block,
    );
    return receipt;
  }
}
