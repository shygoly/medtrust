import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DraftSecretFlowSpecDto } from './dto/draft-secretflow-spec.dto';
import { SecretFlowAssistantService } from './secretflow-assistant.service';

@ApiTags('secretflow-assistant')
@Controller('secretflow/assistant')
export class SecretFlowAssistantController {
  constructor(private readonly assistant: SecretFlowAssistantService) {}

  @Post('draft')
  @ApiOperation({
    summary:
      '自然语言 → SecretFlowTaskSpec 草稿（LLM 仅生成草稿，提交仍走 /secretflow/preview + /tasks）。',
  })
  draft(@Body() body: DraftSecretFlowSpecDto) {
    return this.assistant.draft(body.description, body.purpose);
  }
}
