import { IsArray, IsObject, IsOptional, IsString } from "class-validator";

export class CreateCompositionDto {
  @IsString()
  scenarioKey!: string;

  @IsOptional() @IsArray() modelKeys?: string[];
  @IsOptional() @IsArray() algorithmKeys?: string[];
  @IsOptional() @IsArray() operatorKeys?: string[];
  @IsOptional() @IsArray() protocolKeys?: string[];
  @IsOptional() @IsArray() infraKeys?: string[];

  /** 所选隐私参数: { anonymizationKey?, kAnonymity?, epsilon? } */
  @IsOptional() @IsObject() chosenParams?: Record<string, unknown>;

  /** 风险维度: dataSensitivity/participantCount/dataFlowChain/... */
  @IsOptional() @IsObject() riskDimensions?: Record<string, unknown>;

  @IsOptional() @IsString() computeTaskId?: string;
}
