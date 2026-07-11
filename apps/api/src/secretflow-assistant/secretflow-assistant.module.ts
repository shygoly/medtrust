import { Module } from "@nestjs/common";
import { SecretFlowAssistantController } from "./secretflow-assistant.controller";
import { SecretFlowAssistantService } from "./secretflow-assistant.service";

/**
 * LLM task-design assistant — decoupled from the execution layer.
 * Generates a SecretFlowTaskSpec draft from natural language; submission still
 * goes through SecretFlowOrchestratorModule (PEP admission + output gate).
 * Reads DEEPSEEK_* from the global ConfigModule.
 */
@Module({
  controllers: [SecretFlowAssistantController],
  providers: [SecretFlowAssistantService],
})
export class SecretFlowAssistantModule {}
