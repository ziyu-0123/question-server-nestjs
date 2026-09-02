import { Controller, Post, Body, Req } from '@nestjs/common';
import { type Request } from 'express';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

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

  /**
   * 补全/润色单个问卷组件（纯生成，不落库）
   * 入参: Body { component: { type, props }, instruction? }，需登录（Bearer token）
   * 返回: { props }（与入参组件同构，radio/checkbox 选项已重写 value）
   */
  @Post('optimize-component')
  async optimizeComponent(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { component: unknown; instruction?: string },
  ) {
    return await this.aiService.optimizeComponent(
      req.user.username,
      body?.component,
      body?.instruction,
    );
  }

  /**
   * 整卷翻译为指定目标语言（纯生成，不落库）
   * 入参: Body { targetLang: string, question: { title, desc, componentList } }，需登录（Bearer token）
   * 返回: 与入参同构的译文 { title, desc, componentList: [{ type, props }] }（仅文案为译文）
   */
  @Post('translate-question')
  async translateQuestion(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { targetLang: string; question: unknown },
  ) {
    return await this.aiService.translateQuestion(
      req.user.username,
      body?.targetLang,
      body?.question,
    );
  }
}
