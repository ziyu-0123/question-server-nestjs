import { Controller, Post, Body, Req, Res } from '@nestjs/common';
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
   * AI 生成访谈提纲（纯生成，不落库）
   * 入参: Body { title: 访谈标题, desc: 访谈描述 }，需登录（Bearer token）
   * 返回: { outline: string[] }
   * 错误: 400 请填写访谈标题 / 请先配置 AI 模型
   */
  @Post('generate-interview-outline')
  async generateInterviewOutline(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { title: string; desc: string },
  ) {
    return await this.aiService.generateInterviewOutline(
      req.user.username,
      body?.title,
      body?.desc,
    );
  }

  /**
   * AI 访谈流式对话（SSE，逐字返回 AI 访谈员的回复）
   * 入参: Body { questionId, history: [{ role, content }] }，公开接口（填写者匿名）
   * 返回: text/event-stream，逐 chunk 推送 data: <增量文本>，结束推送 data: [DONE]
   * 错误: 400 参数不合法 / 不是访谈问卷 / 未发布 / 超轮次 / 创建者未配置；404 问卷不存在
   */
  @Public()
  @Post('interview/stream')
  async interviewStream(
    @Res() res: Response,
    @Body() body: { questionId: string; history: { role: string; content: string }[] },
  ) {
    // 校验在 service 内完成（失败抛 HttpException，由全局 filter 转 JSON）；
    // 通过后返回流式闭包，此处才设置 SSE 响应头，绕开全局拦截器/过滤器
    const stream = await this.aiService.prepareInterviewStream(
      body?.questionId,
      body?.history ?? [],
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await stream((text) => {
        res.write(`data: ${JSON.stringify(text)}\n\n`);
      });
      res.write('data: [DONE]\n\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 请求失败';
      res.write(`event: error\ndata: ${JSON.stringify(message)}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * AI 总结访谈答卷（整卷主题聚类 + 情感，纯生成，不落库）
   * 入参: Body { questionId }，需登录（Bearer token，须为问卷作者）
   * 返回: { summary, totalCount, themes: [{ label, count, description }], sentiment }
   * 错误: 400 参数不合法 / 请先配置 / 不是访谈问卷 / 暂无访谈答卷；403 非作者；404 问卷不存在
   */
  @Post('summarize-interview')
  async summarizeInterview(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { questionId: string },
  ) {
    return await this.aiService.summarizeInterview(
      req.user.username,
      body?.questionId,
    );
  }
}
