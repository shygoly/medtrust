import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContractService, ContractApplyInput } from './contract.service';
import { AttestationService } from './attestation.service';
import { ApproveContractDto } from './dto/approve-contract.dto';
import { RequestContractDto } from './dto/request-contract.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ParticipantRolesGuard } from '../../auth/participant-roles.guard';
import { ParticipantRoles } from '../../auth/participant-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// 新控制面数字合约端点。前端将从旧 /access-requests 切到这里(8.2 切换前置)。
// 授权 = 批准生成数字合约,取代一次性审批。
@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly attestation: AttestationService,
  ) {}

  @Get()
  list(@CurrentUser() user: { role?: string; participantId?: string }) {
    return this.contracts.list({ role: user?.role, participantId: user?.participantId });
  }

  /** 药企发起数字合约申请（draft） */
  @Post('requests')
  @ParticipantRoles('consumer')
  request(@Body() dto: RequestContractDto, @CurrentUser('participantId') consumerId: string) {
    return this.contracts.request(dto as ContractApplyInput, consumerId);
  }

  /** 医院直接签发（跳过申请，active） */
  @Post()
  @ParticipantRoles('provider')
  approve(@Body() dto: ApproveContractDto) {
    return this.contracts.approve(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const contract = await this.contracts.get(id);
    if (!contract) throw new NotFoundException('数字合约不存在');
    return contract;
  }

  /** 医院审批药企申请 → 签发 active 合约 */
  @Post(':id/approve')
  @ParticipantRoles('provider')
  approveDraft(@Param('id') id: string, @CurrentUser('participantId') providerId: string) {
    return this.contracts.approveDraft(id, providerId);
  }

  /** 医院驳回药企申请 */
  @Post(':id/reject')
  @ParticipantRoles('provider')
  rejectDraft(@Param('id') id: string, @CurrentUser('participantId') providerId: string) {
    return this.contracts.rejectDraft(id, providerId);
  }

  @Post(':id/revoke')
  @ParticipantRoles('provider')
  async revoke(@Param('id') id: string) {
    if (!(await this.contracts.get(id))) throw new NotFoundException('数字合约不存在');
    await this.contracts.revoke(id);
    return { id, status: 'revoked' };
  }

  // 合约哈希上链存证
  @Post(':id/attest')
  async attest(@Param('id') id: string) {
    const contract = await this.contracts.get(id);
    if (!contract) throw new NotFoundException('数字合约不存在');
    return this.attestation.attestContract(contract);
  }
}
