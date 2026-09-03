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
}
