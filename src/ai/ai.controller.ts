import { Controller, Post, Body, Req } from '@nestjs/common';
import { type Request } from 'express';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * 根据需求描述生成问卷（纯生成，不落库）
   * 入参: Body { prompt: string }，需登录（Bearer token）
   * 返回: { title, desc, componentList }，componentList 已含 fe_id 及规范化 props
   */
  @Post('generate-question')
  async generateQuestion(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { prompt: string },
  ) {
    return await this.aiService.generateQuestion(req.user.username, body?.prompt);
  }
}
