import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContractService } from './contract.service';
import { AttestationService } from './attestation.service';
import { ApproveContractDto } from './dto/approve-contract.dto';

// 新控制面数字合约端点。前端将从旧 /access-requests 切到这里(8.2 切换前置)。
// 授权 = 批准生成数字合约,取代一次性审批。
@ApiTags('contracts')
@Controller('contracts')
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly attestation: AttestationService,
  ) {}

  @Get()
  list() {
    return this.contracts.list();
  }

  @Post()
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
