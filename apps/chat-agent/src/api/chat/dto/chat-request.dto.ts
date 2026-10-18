import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 对话请求体。
 *
 * 这里只用 `@ApiProperty*` 描述**契约**（生成 OpenAPI），不挂 class-validator：
 * 边界校验的唯一事实源是 `normalizeUserMessage()`（类型/控制字符/长度 413）。
 * 两处都管会出现"文档说必填、实现按别的规则拒"的经典漂移。
 */
export class ChatRequestDto {
  @ApiProperty({
    description: '用户自然语言消息（≤ CHAT_MAX_MESSAGE_CHARS，去控制字符后不得为空）',
    example: '我想做单臂试验的外部对照',
  })
  message!: string;

  @ApiPropertyOptional({ description: '续用已有会话；缺省新建' })
  sessionId?: string;

  @ApiPropertyOptional({ description: '空间 id；缺省取请求头/身份里的空间' })
  spaceId?: string;

  @ApiPropertyOptional({
    description: '用户显式选择的助手意图；缺省走规则路由',
    enum: [
      'study-design',
      'access-contract',
      'result-interpretation',
      'platform-ops',
      'compliance-evidence',
      'hospital-mapping',
    ],
  })
  assistantIntent?: string;

  @ApiPropertyOptional({ description: '当前页面路径，用于上下文路由；不含数据载荷' })
  page?: string;

  @ApiPropertyOptional({
    description: '当前对象深链：只含对象类型、ID、页面和可见状态',
    example: { objectType: 'data-product', objectId: 'dp-1', page: '/space/catalog' },
  })
  context?: {
    objectType?: string;
    objectId?: string;
    page?: string;
    status?: string;
  };
}
