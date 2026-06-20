import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { NodeCapabilityProfile } from '../types';

export interface TaskBudget {
  amount: number;
  currency: string;
}

export class OrchestrateSecretFlowTaskDto {
  /** Optional client-supplied task id; generated if omitted. */
  @IsOptional()
  @IsString()
  taskId?: string;

  /** Declarative spec as a YAML (or JSON) string. */
  @IsOptional()
  @IsString()
  specYaml?: string;

  /** Declarative spec as an already-decoded object (alternative to specYaml). */
  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  /** Reported hardware/capability profiles per participant. */
  @IsOptional()
  @IsArray()
  profiles?: NodeCapabilityProfile[];

  /** Digital contracts authorizing this task (PEP admission, fail-closed). */
  @IsOptional()
  @IsArray()
  contractIds?: string[];

  /** Declared purpose; must match the referenced contracts' purpose if set. */
  @IsOptional()
  @IsString()
  purpose?: string;

  /** Settlement budget split across providers by contribution. */
  @IsOptional()
  @IsObject()
  budget?: TaskBudget;
}
