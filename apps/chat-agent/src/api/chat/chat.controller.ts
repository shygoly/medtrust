import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import type { ChatIdentity, ChatResponseDto } from './chat.types';
import type { ChatSession } from '../../session/session.types';

const DEFAULT_USER = 'demo-user';
const DEFAULT_SPACE = 'sh-med';

/**
 * 最小身份实现：`x-user-id` / `x-space-id` 请求头。
 * 接入控制面 JWT 后由 AuthGuard 注入（tasks 2.1.7），DTO 与 service 签名不变。
 */
function identityOf(
  userId?: string,
  spaceId?: string,
  authorization?: string,
  role?: string,
): ChatIdentity {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  return {
    userId: userId?.trim() || DEFAULT_USER,
    spaceId: spaceId?.trim() || DEFAULT_SPACE,
    ...(token ? { accessToken: token } : {}),
    ...(role ? { role } : {}),
  };
}

@ApiTags('chat')
// 身份先在文档里说清楚：当前是开发期的最小实现（请求头），接 JWT 后换成 AuthGuard。
@ApiHeader({ name: 'x-user-id', required: false, description: '开发期用户标识；缺省 demo-user' })
@ApiHeader({ name: 'x-space-id', required: false, description: '空间标识；缺省 sh-med' })
@ApiHeader({ name: 'authorization', required: false, description: 'Bearer 令牌；提交作业时透传给控制面' })
@Controller('chat')
@UseGuards(RateLimitGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: '一次性对话', description: '自然语言 → 卡片/文本；与 /chat/stream 共用同一条实现。' })
  @ApiOkResponse({ description: '助手回复（message + cards + suggestions）' })
  @ApiResponse({ status: 400, description: 'message 非字符串或为空' })
  @ApiResponse({ status: 413, description: 'message 超过 CHAT_MAX_MESSAGE_CHARS' })
  @ApiResponse({ status: 429, description: '触发限流（响应头带 Retry-After）' })
  chat(
    @Body() dto: ChatRequestDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-space-id') spaceId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-user-role') role?: string,
  ): Promise<ChatResponseDto> {
    return this.chatService.chat(dto, identityOf(userId, spaceId, authorization, role));
  }

  /**
   * 事件流（4.1.1）：`POST` + SSE，而不是 `EventSource`（它只能 GET，带不了请求体）。
   * 前端用 fetch + ReadableStream 读帧（见 apps/web/src/lib/chat-api.ts 的 parseSseFrames）。
   */
  @Post('stream')
  @ApiOperation({
    summary: '步骤级 SSE 事件流',
    description:
      'event 类型：start / tool / card / done / error。注意这是**步骤级**，不是 token 级。' +
      '参数错误在写响应头之前以 4xx JSON 返回，而不是 200 + error 帧。',
  })
  @ApiProduces('text/event-stream')
  @ApiResponse({ status: 201, description: 'SSE 流：start → (tool)* → (card)* → done' })
  @ApiResponse({ status: 400, description: '入参非法（JSON，非 SSE）' })
  @ApiResponse({ status: 413, description: '消息过长（JSON，非 SSE）' })
  @ApiResponse({ status: 429, description: '触发限流' })
  async stream(
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
    @Headers('x-user-id') userId?: string,
    @Headers('x-space-id') spaceId?: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-user-role') role?: string,
  ): Promise<void> {
    // 关键顺序：先校验。响应头一旦写成 text/event-stream，状态码就改不了，
    // 参数错误必须在写头之前以正常 4xx JSON 抛出。
    this.chatService.validateRequest(dto);
    const identity = identityOf(userId, spaceId, authorization, role);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // 让 nginx 不做缓冲，否则"流式"会被攒成一个包才发出去
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 心跳：长时间无输出的连接会被中间网关掐掉
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15_000);

    // 客户端断开后不再写，但**继续把流程跑完**（会话照常落库，重连能看到结果）。
    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of this.chatService.chatStream(dto, identity)) {
        if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      if (!closed) {
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message })}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  @Get('sessions')
  @ApiOperation({ summary: '会话列表（不含消息体）' })
  @ApiOkResponse({ description: '当前用户的会话摘要，按更新时间倒序' })
  listSessions(
    @Headers('x-user-id') userId?: string,
    @Headers('x-space-id') spaceId?: string,
    @Query('spaceId') querySpaceId?: string,
  ): Promise<ChatSession[]> {
    return this.chatService.listSessions(
      identityOf(userId, querySpaceId || spaceId),
      querySpaceId || spaceId,
    );
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '会话详情（含消息与卡片）' })
  @ApiResponse({ status: 403, description: '不是本人的会话' })
  @ApiResponse({ status: 404, description: '会话不存在或已过期' })
  getSession(@Param('id') id: string, @Headers('x-user-id') userId?: string): Promise<ChatSession> {
    return this.chatService.getSession(id, identityOf(userId));
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: '删除会话（幂等）' })
  deleteSession(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ success: boolean }> {
    return this.chatService.deleteSession(id, identityOf(userId));
  }
}
