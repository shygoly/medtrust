import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContractService } from './contract.service';
import { AttestationService } from './attestation.service';
import { ApproveContractDto } from './dto/approve-contract.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ParticipantRolesGuard } from '../auth/participant-roles.guard';
import { ParticipantRoles } from '../auth/participant-role.decorator';

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
  list() {
    return this.contracts.list();
  }

  // 仅数据提供方可批准/签发数字合约
  @Post()
  @ParticipantRoles('provider')
  approve(@Body() dto: ApproveContractDto) {
    return this.contracts.approve(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const contract = this.contracts.get(id);
    if (!contract) throw new NotFoundException('数字合约不存在');
    return contract;
  }

  @Post(':id/revoke')
  @ParticipantRoles('provider')
  revoke(@Param('id') id: string) {
    if (!this.contracts.get(id)) throw new NotFoundException('数字合约不存在');
    this.contracts.revoke(id);
    return { id, status: 'revoked' };
  }

  // 合约哈希上链存证
  @Post(':id/attest')
  attest(@Param('id') id: string) {
    const contract = this.contracts.get(id);
    if (!contract) throw new NotFoundException('数字合约不存在');
    return this.attestation.attestContract(contract);
  }
}
