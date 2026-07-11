import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { BlockchainService } from "./blockchain.service";
import {
  CreateAttestationDto,
  VerifyAttestationDto,
  AttestationResponseDto,
  VerificationResponseDto,
} from "./dto/attestation.dto";

@ApiTags("blockchain")
@Controller("blockchain")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Post("attest")
  @ApiOperation({ summary: "Submit data attestation to blockchain" })
  @ApiResponse({
    status: 201,
    description: "Attestation created successfully",
    type: AttestationResponseDto,
  })
  @ApiResponse({ status: 409, description: "Data already attested" })
  async createAttestation(
    @Request() req,
    @Body() dto: CreateAttestationDto,
  ): Promise<AttestationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.blockchainService.createAttestation(tenantId, dto);
  }

  @Post("verify")
  @ApiOperation({ summary: "Verify data attestation against blockchain" })
  @ApiResponse({
    status: 200,
    description: "Verification result",
    type: VerificationResponseDto,
  })
  @ApiResponse({ status: 404, description: "Attestation not found" })
  async verifyAttestation(
    @Request() req,
    @Body() dto: VerifyAttestationDto,
  ): Promise<VerificationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.blockchainService.verifyAttestation(tenantId, dto);
  }

  @Get("attestations")
  @ApiOperation({ summary: "Query attestation history" })
  @ApiQuery({ name: "attestation_type", required: false })
  @ApiQuery({ name: "data_id", required: false })
  @ApiQuery({ name: "from_date", required: false })
  @ApiQuery({ name: "to_date", required: false })
  @ApiResponse({
    status: 200,
    description: "Attestations retrieved",
    type: [AttestationResponseDto],
  })
  async getAttestations(
    @Request() req,
    @Query("attestation_type") attestationType?: string,
    @Query("data_id") dataId?: string,
    @Query("from_date") fromDate?: string,
    @Query("to_date") toDate?: string,
  ): Promise<AttestationResponseDto[]> {
    const tenantId = req.user.tenantId;
    return this.blockchainService.getAttestations(tenantId, {
      attestation_type: attestationType,
      data_id: dataId,
      from_date: fromDate ? new Date(fromDate) : undefined,
      to_date: toDate ? new Date(toDate) : undefined,
    });
  }

  @Get("attestations/:id")
  @ApiOperation({ summary: "Get specific attestation" })
  @ApiResponse({
    status: 200,
    description: "Attestation retrieved",
    type: AttestationResponseDto,
  })
  @ApiResponse({ status: 404, description: "Attestation not found" })
  async getAttestation(
    @Request() req,
    @Param("id") id: string,
  ): Promise<AttestationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.blockchainService.getAttestation(tenantId, parseInt(id, 10));
  }
}
