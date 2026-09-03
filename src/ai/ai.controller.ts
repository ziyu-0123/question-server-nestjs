import { Controller, Post, Body, Req, Res, Get, Param, HttpCode } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { AiService } from './ai.service.js';
import { Public } from '../auth/decorators/public.decorator.js';

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

  /**
   * AI 总结开放式问题的答案（意见聚类 + 情感分析，纯生成，不落库）
   * 入参: Body { questionId: 问卷 id, componentId: 开放式组件 fe_id }，需登录（Bearer token，须为问卷作者）
   * 返回: { summary, totalCount, themes: [{ label, count, description }], sentiment: { positive, negative, neutral } }
   * 错误: 400 参数不合法 / 请先配置 / 组件不存在 / 该题目不是开放式问题 / 该题目暂无有效答案；403 非作者；404 问卷不存在
   */
  @Post('summarize-answers')
  async summarizeAnswers(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { questionId: string; componentId: string },
  ) {
    return await this.aiService.summarizeAnswers(
      req.user.username,
      body?.questionId,
      body?.componentId,
    );
  }

  /**
   * AI 生成整卷分析报告（总体结论 + 每题洞察 + 改进建议，纯生成，不落库）
   * 入参: Body { questionId: 问卷 id }，需登录（Bearer token，须为问卷作者）
   * 返回: { overview, insights: [{ question, finding, chartDesc }], suggestions: string[] }
   * 错误: 400 参数不合法 / 请先配置 / 暂无答卷；403 非问卷作者；404 问卷不存在
   */
  @Post('analyze-report')
  async analyzeReport(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { questionId: string },
  ) {
    return await this.aiService.analyzeReport(
      req.user.username,
      body?.questionId,
    );
  }

  /**
   * C 端问卷页判断是否展示"AI 对话模式"入口（公开接口，无需登录）
   * 入参: 路径参数 questionId
   * 返回: { chatEnabled: boolean }（已发布 && 未删除 && 作者已配置 AI && 无译文）
   * 错误: 400 参数不合法
   */
  @Public()
  @Get('chat-status/:questionId')
  async chatStatus(@Param('questionId') questionId: string) {
    return await this.aiService.isChatEnabled(questionId);
  }

  /**
   * 对话式问卷的一轮对话（公开接口 + 匿名限流，使用问卷作者的 AI 配置，SSE 流式响应）
   * 入参: Body { questionId, componentId: 当前停留题 fe_id, messages: 对话记录 }
   * 出参: text/event-stream —— event:delta 逐段问话正文 / event:meta { stay|end|skip } 指令 /
   *       event:error { msg }（流中错误）/ 结束标记 data:[DONE]
   * 错误（写流之前）: 400 参数或消息不合法 / 未发布 / 未开启 AI 对话 / 无可对话题目；404 问卷不存在；429 限流
   */
  @Public()
  @HttpCode(200) // SSE 流式响应语义应为 200（@Post 默认 201）
  @Post('chat')
  async chat(
    @Req() req: Request,
    @Body() body: { questionId: string; componentId: string; messages: unknown },
    @Res() res: Response,
  ) {
    const { questionId, componentId, messages } = body ?? {};

    // 写 SSE 头之前的所有校验走正常异常通道（异常过滤器可正常改写响应）
    const xff = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]) ?? req.ip ?? '';
    this.aiService.checkRateLimit(questionId, ip);
    const prepared = await this.aiService.prepareChat(questionId, componentId, messages);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const item of this.aiService.streamChat(
        prepared.client,
        prepared.model,
        prepared.messages,
      )) {
        if (item.delta) send('delta', { text: item.delta });
        if (item.meta) send('meta', item.meta);
        if (item.error) send('error', { msg: item.error });
      }
    } catch {
      send('error', { msg: 'AI 请求失败，请稍后重试' });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}
