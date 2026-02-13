import { Controller, Post, Get, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FhirService } from './fhir.service';

@ApiTags('fhir')
@Controller('fhir')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FhirController {
  constructor(private readonly fhirService: FhirService) {}

  // Patient endpoints
  @Post('Patient')
  @ApiOperation({ summary: 'Create FHIR Patient resource' })
  @ApiResponse({ status: 201, description: 'Patient created successfully' })
  async createPatient(@Body() patientData: any) {
    return this.fhirService.createPatient(patientData);
  }

  @Get('Patient/:id')
  @ApiOperation({ summary: 'Read FHIR Patient resource' })
  @ApiResponse({ status: 200, description: 'Patient retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getPatient(@Param('id') id: string) {
    return this.fhirService.getPatient(id);
  }

  @Put('Patient/:id')
  @ApiOperation({ summary: 'Update FHIR Patient resource' })
  @ApiResponse({ status: 200, description: 'Patient updated successfully' })
  async updatePatient(@Param('id') id: string, @Body() patientData: any) {
    return this.fhirService.updatePatient(id, patientData);
  }

  @Get('Patient')
  @ApiOperation({ summary: 'Search FHIR Patient resources' })
  @ApiResponse({ status: 200, description: 'Patients retrieved successfully' })
  async searchPatients(
    @Query('name') name?: string,
    @Query('identifier') identifier?: string,
  ) {
    return this.fhirService.searchPatients({ name, identifier });
  }

  // Observation endpoints
  @Post('Observation')
  @ApiOperation({ summary: 'Create FHIR Observation resource' })
  @ApiResponse({ status: 201, description: 'Observation created successfully' })
  async createObservation(@Body() observationData: any) {
    return this.fhirService.createObservation(observationData);
  }

  @Get('Observation/:id')
  @ApiOperation({ summary: 'Read FHIR Observation resource' })
  @ApiResponse({ status: 200, description: 'Observation retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Observation not found' })
  async getObservation(@Param('id') id: string) {
    return this.fhirService.getObservation(id);
  }

  @Get('Observation')
  @ApiOperation({ summary: 'Search FHIR Observation resources' })
  @ApiResponse({ status: 200, description: 'Observations retrieved successfully' })
  async searchObservations(
    @Query('patient') patient?: string,
    @Query('code') code?: string,
    @Query('date') date?: string,
  ) {
    return this.fhirService.searchObservations({ patient, code, date });
  }
}
