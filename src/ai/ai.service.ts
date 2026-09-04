import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { APIConnectionTimeoutError, AuthenticationError, BadRequestError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { UserService } from '../user/user.service.js';
import { QuestionService } from '../question/question.service.js';
import { AnswerService } from '../answer/answer.service.js';
import {
  generateQuestionSchema,
  componentSchema,
  propsSchemas,
  translateQuestionSchema,
  summarizeAnswersSchema,
  reportSchema,
  generateInterviewOutlineSchema,
  type GenerateQuestionResult,
  type TranslateQuestionResult,
  type SummarizeAnswersResult,
  type ReportResult,
  type GenerateInterviewOutlineResult,
  type ComponentInput,
} from './schemas/generate-question.schema.js';

// AI 接口不落库，仅做纯生成；此处类型即 componentList 单项的最终形态
type NormalizedComponent = {
  fe_id: string;
  type: string;
  title: string;
  isHidden: boolean;
  isLocked: boolean;
  props: Record<string, unknown>;
};

// 组件 type → 图层面板显示名（与编辑器 Layers 列表的命名习惯一致）
const COMPONENT_LABELS: Record<string, string> = {
  questionInfo: '问卷信息',
  questionTitle: '标题',
  questionParagraph: '段落',
  questionInput: '单行输入',
  questionTextarea: '多行输入',
  questionRadio: '单选',
  questionCheckbox: '多选',
};

// 7 种组件的类型与 props 契约（生成问卷与单题优化共用的单一事实来源）
const COMPONENT_CONTRACT = `【可用的 7 种组件类型】（type 与 props 结构必须严格匹配）
1. questionInfo —— 问卷信息（标题+描述），每个问卷开头必须且只能有一个
   { "type": "questionInfo", "props": { "title": "食堂满意度调查", "desc": "为了改善食堂服务质量，请花 1 分钟填写" } }
2. questionTitle —— 分组小标题
   { "type": "questionTitle", "props": { "text": "第一部分：总体评价", "level": 2, "isCenter": false } }
   level 取 1~5 的整数
3. questionParagraph —— 说明段落
   { "type": "questionParagraph", "props": { "text": "本部分为匿名填写，请放心作答", "isCenter": false } }
4. questionInput —— 单行填空
   { "type": "questionInput", "props": { "title": "您最希望增加哪个菜品？", "placeholder": "请输入菜品名称" } }
5. questionTextarea —— 多行填空
   { "type": "questionTextarea", "props": { "title": "其他意见或建议", "placeholder": "请输入..." } }
6. questionRadio —— 单选题
   { "type": "questionRadio", "props": { "title": "您对食堂饭菜的总体满意度是？", "isVertical": false, "options": [ { "text": "非常满意" }, { "text": "满意" }, { "text": "不满意" } ] } }
7. questionCheckbox —— 多选题
   { "type": "questionCheckbox", "props": { "title": "您在食堂通常选择哪些主食？", "isVertical": false, "list": [ { "text": "米饭" }, { "text": "面条" }, { "text": "馒头" } ] } }`;

const GENERATE_SYSTEM_PROMPT = `你是问卷设计专家，根据用户需求生成结构完整的调查问卷。

【输出契约】
只输出一个 JSON 对象，结构为：
{
  "title": "问卷标题",
  "desc": "问卷描述（一句话，说明调查目的）",
  "componentList": [ { "type": "组件类型", "props": { ... } }, ... ]
}
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

${COMPONENT_CONTRACT}

【设计规则】
- componentList 第一个组件必须是 questionInfo，其 title/desc 与顶层 title/desc 一致
- 可在题目间穿插 questionTitle / questionParagraph 作分组和说明
- 题目总数 5~10 题，以 questionRadio / questionCheckbox 为主，questionInput / questionTextarea 各 1~2 题收尾
- 单选 options 2~6 个，多选 list 3~8 个；只写 text 字段，不要生成 value 字段（系统自动生成）
- isVertical 默认 false（选项少的题）；文案使用简体中文，贴合用户需求场景`;

const OPTIMIZE_SYSTEM_PROMPT = `你是问卷题目优化专家，负责润色和补全问卷中的单个组件。

【输出契约】
只输出一个 JSON 对象，结构为：
{ "props": { ... } }
props 的结构与该组件类型的契约严格匹配。禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

${COMPONENT_CONTRACT}

【优化规则】
- 在保持原意的前提下润色文案，使表述更清晰、专业、得体；只做润色和补全，不推翻重写
- 题目类组件可补全/优化选项，使选项覆盖常见情况、互斥且完整
- 未被要求修改的字段必须原样返回，不得丢失或改动
- 选项只写 text 字段，不要生成 value 字段（系统自动生成）
- 文案使用简体中文`;

const TRANSLATE_SYSTEM_PROMPT = `你是专业问卷翻译，负责把问卷从原语言翻译成用户指定的目标语言。

【输出契约】
只输出一个 JSON 对象，结构为：
{
  "title": "问卷标题译文",
  "desc": "问卷描述译文",
  "componentList": [ { "type": "组件类型", "props": { ... } }, ... ]
}
componentList 与输入完全同构：组件数量、顺序、type 一一对应，禁止增删组件或改变顺序。
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

${COMPONENT_CONTRACT}

【翻译规则】
- 只翻译文案字段（title / desc / text / placeholder / 选项的 text）；level、isCenter、isVertical 等布局字段原样保留
- 选项逐条对应翻译，不增不减，严格保持数组顺序；只写 text 字段，不要生成 value 字段
- 顶层 title/desc 与第一个 questionInfo 组件的 title/desc 译文保持一致
- 译文自然地道，符合问卷调查语域；数字、单位、专有名词处理合理`;

const SUMMARIZE_SYSTEM_PROMPT = `你是问卷数据分析助手，负责对开放式问题的答案做意见聚类和情感分析。

【输出契约】
只输出一个 JSON 对象，结构为：
{
  "summary": "一段话总体结论（100 字以内，概括答案反映的主要情况和倾向）",
  "totalCount": 有效答案总条数（即输入中标注的 totalCount，原样返回）",
  "themes": [
    { "label": "意见类别名（10 字以内）", "count": 该类条数, "description": "该类意见概述，并摘录 1~2 条典型原话" },
    ...
  ],
  "sentiment": { "positive": 正面条数, "negative": 负面条数, "neutral": 中性条数 }
}
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

【分析规则】
- themes 聚 3~6 类，按 count 从大到小排列；每条答案的"出现次数"要计入对应类别的 count
- 灌水、纯符号、无实际观点的答案归入一个"无有效观点"类正常输出
- themes 各 count 之和 ≈ totalCount；sentiment 三项之和 ≈ totalCount（按对答案的整体理解估算，允许小幅出入）
- 全部使用简体中文；不要发明答案中没有的信息`;

const REPORT_SYSTEM_PROMPT = `你是问卷数据分析专家，负责综合整卷统计数据生成解读报告。

【输出契约】
只输出一个 JSON 对象，结构为：
{
  "overview": "总体结论（150 字以内：答卷规模、总体倾向、最突出的问题）",
  "insights": [
    { "question": "题干", "finding": "该题核心发现（必须引用具体数字，如'60% 表示不满意'）", "chartDesc": "一句话图表呈现建议（如'建议用饼图展示三项占比'）" },
    ...
  ],
  "suggestions": ["改进建议（具体可操作）", ...]
}
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

【分析规则】
- insights 按题目顺序，每道有数据的题一条；开放题结合答案原声归纳
- suggestions 2~4 条，针对最突出的问题，具体可操作
- 全部使用简体中文；只能引用输入中给出的数字与答案，不要发明数据`;

const INTERVIEW_OUTLINE_SYSTEM_PROMPT = `你是专业访谈提纲设计师，根据访谈目标设计引导问题清单。

【输出契约】
只输出一个 JSON 对象，结构为：
{ "outline": ["问题1", "问题2", ...] }
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

【设计规则】
- 产出 5~8 个开放式引导问题，层层递进、覆盖关键维度
- 问题口语化、中立无引导倾向，适合访谈场景
- 全部使用简体中文`;

const INTERVIEW_SUMMARY_SYSTEM_PROMPT = `你是访谈数据分析助手，负责对多份访谈的聊天记录做主题聚类和情感分析。

【输出契约】
只输出一个 JSON 对象，结构为：
{
  "summary": "一段话总体结论（100 字以内，概括受访者的主要观点和倾向）",
  "totalCount": 参与分析的访谈答卷份数（即输入中标注的 totalCount，原样返回）",
  "themes": [
    { "label": "主题类别名（10 字以内）", "count": 提及该主题的访谈份数, "description": "该主题概述，并摘录 1~2 条典型原话" },
    ...
  ],
  "sentiment": { "positive": 正面倾向份数, "negative": 负面倾向份数, "neutral": 中性倾向份数 }
}
禁止输出 JSON 以外的任何文字（包括解释、markdown 代码块标记）。

【分析规则】
- themes 聚 3~6 类，按 count 从大到小排列；count 为该主题被提及的访谈份数（估算）
- sentiment 三项之和 ≈ totalCount（按每份访谈的整体倾向估算）
- 全部使用简体中文；不要发明记录中没有的信息`;

@Injectable()
export class AiService {
  constructor(
    private readonly userService: UserService,
    private readonly questionService: QuestionService,
    private readonly answerService: AnswerService,
  ) { }

  /**
   * 根据需求描述生成问卷（纯生成，不落库）
   * 入参: username（登录态用户）、prompt（需求描述）
   * 返回: { title, desc, componentList }（componentList 已生成 fe_id 并规范化 options value）
   */
  async generateQuestion(username: string, prompt: string) {
    if (!prompt?.trim()) {
      throw new BadRequestException('请填写需求描述');
    }
    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: GENERATE_SYSTEM_PROMPT },
      { role: 'user', content: prompt.trim() },
    ];

    const result = await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      generateQuestionSchema,
    );
    return this.normalize(result);
  }

  /**
   * 补全/润色单个问卷组件（纯生成，不落库）
   * 入参: username（登录态用户）、component（{ type, props }）、instruction?（自定义优化指令，二期）
   * 返回: { props }（与入参同构，radio/checkbox 的 options/list 已重写 value）
   */
  async optimizeComponent(username: string, component: unknown, instruction?: string) {
    // 入参双向校验：既挡脏数据，也保证 propsSchemas[type] 取值安全
    const input = componentSchema.safeParse(component);
    if (!input.success) {
      throw new BadRequestException('组件数据不合法，请刷新页面后重试');
    }
    const { type, props } = input.data as ComponentInput;
    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    // 输出契约：{ props }，按入参 type 选取对应的 props schema 精校
    const outputSchema = z.object({ props: propsSchemas[type] });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请优化以下问卷组件：\n${JSON.stringify({ type, props })}${instruction?.trim() ? `\n\n优化要求：${instruction.trim()}` : ''
          }`,
      },
    ];

    const result = await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      outputSchema,
    );

    // props 是 zod strip 后的干净对象（不含 value），此处重写选项 value 供统计聚合
    const newProps = result.props as Record<string, unknown>;
    this.normalizeOptions(type, newProps);
    return { props: newProps };
  }

  /**
   * 整卷翻译为指定目标语言（纯生成，不落库）
   * 入参: username（登录态用户）、targetLang（目标语言）、question（原问卷投影 { title, desc, componentList }）
   * 返回: 与入参同构的译文（仅文案字段为译文，不跑 normalizeOptions——
   *       翻译输出只被前端抽取 text 构建 texts，value 不会被使用）
   */
  async translateQuestion(username: string, targetLang: string, question: unknown) {
    if (!targetLang?.trim()) {
      throw new BadRequestException('请选择目标语言');
    }
    const input = translateQuestionSchema.safeParse(question);
    if (!input.success) {
      throw new BadRequestException('问卷数据不合法，请刷新页面后重试');
    }
    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `目标语言：${targetLang.trim()}\n请翻译以下问卷：\n${JSON.stringify(input.data)}`,
      },
    ];

    const result: TranslateQuestionResult = await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      translateQuestionSchema,
    );
    return result;
  }

  /**
   * AI 总结开放式问题的答案（聚类 + 情感，纯生成，不落库）
   * 入参: username（登录态用户，须为问卷作者）、questionId、componentId（开放式组件 fe_id）
   * 返回: { summary, totalCount, themes, sentiment }
   */
  async summarizeAnswers(
    username: string,
    questionId: string,
    componentId: string,
  ): Promise<SummarizeAnswersResult> {
    if (!questionId?.trim() || !componentId?.trim()) {
      throw new BadRequestException('参数不合法');
    }

    const question = await this.questionService.findOne(questionId);
    if (!question) {
      throw new NotFoundException('问卷不存在');
    }
    if (question.author !== username) {
      throw new ForbiddenException('无权操作该问卷');
    }

    const comp = (question.componentList ?? []).find(
      (c) => c.fe_id === componentId,
    );
    if (!comp) {
      throw new BadRequestException('组件不存在');
    }
    if (comp.type !== 'questionInput' && comp.type !== 'questionTextarea') {
      throw new BadRequestException('该题目不是开放式问题');
    }

    // 提取并预处理答案：空值过滤 → 相同文本合并计数 → 取最新 200 条 → 单条截断 200 字
    const answerTotal = await this.answerService.count(questionId);
    if (answerTotal === 0) {
      throw new BadRequestException('该题目暂无有效答案');
    }
    const answers = await this.answerService.findAll(questionId, {
      page: 1,
      pageSize: answerTotal,
    });

    const { items, totalCount } = this._collectOpenTextAnswers(
      answers,
      componentId,
      200,
    );
    if (totalCount === 0) {
      throw new BadRequestException('该题目暂无有效答案');
    }

    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);
    const title = (comp.props as { title?: string })?.title ?? '';

    const answerLines = items
      .map(
        (item, i) =>
          `${i + 1}. ${JSON.stringify(item.text)}${item.repeat > 1 ? `（出现 ${item.repeat} 次）` : ''}`,
      )
      .join('\n');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `题目：${title}\n有效答案共 ${totalCount} 条（完全相同的答案已合并并标注出现次数）：\n${answerLines}`,
      },
    ];

    return await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      summarizeAnswersSchema,
    );
  }

  /**
   * AI 生成整卷分析报告（总体结论 + 每题洞察 + 改进建议，纯生成，不落库）
   * 入参: username（登录态用户，须为问卷作者）、questionId
   * 返回: { overview, insights: [{ question, finding, chartDesc }], suggestions }
   */
  async analyzeReport(username: string, questionId: string): Promise<ReportResult> {
    if (!questionId?.trim()) {
      throw new BadRequestException('参数不合法');
    }

    const question = await this.questionService.findOne(questionId);
    if (!question) {
      throw new NotFoundException('问卷不存在');
    }
    if (question.author !== username) {
      throw new ForbiddenException('无权操作该问卷');
    }

    const answerTotal = await this.answerService.count(questionId);
    if (answerTotal === 0) {
      throw new BadRequestException('暂无答卷');
    }
    // 拉库一次取全量答卷，后续各题在内存中过滤
    const answers = await this.answerService.findAll(questionId, {
      page: 1,
      pageSize: answerTotal,
    });

    // 按题目顺序组织全卷数据（隐藏组件不进报告，口径与统计页一致）
    const sections: string[] = [];
    let questionIndex = 0;
    for (const comp of question.componentList ?? []) {
      if (comp.isHidden) continue;
      if (
        comp.type !== 'questionRadio' &&
        comp.type !== 'questionCheckbox' &&
        comp.type !== 'questionInput' &&
        comp.type !== 'questionTextarea'
      ) {
        continue; // 结构组件（信息/标题/段落）无统计数据
      }

      questionIndex++;
      const title = (comp.props as { title?: string })?.title ?? '';
      const typeLabel =
        comp.type === 'questionRadio'
          ? '单选'
          : comp.type === 'questionCheckbox'
            ? '多选'
            : comp.type === 'questionInput'
              ? '单行输入'
              : '多行输入';

      if (comp.type === 'questionRadio' || comp.type === 'questionCheckbox') {
        // 选择题：value → text 映射后按选项文案确定性计数
        const opts =
          comp.type === 'questionRadio'
            ? ((comp.props as { options?: { value: string; text: string }[] })?.options ?? [])
            : ((comp.props as { list?: { value: string; text: string }[] })?.list ?? []);
        const textByValue = new Map(opts.map((o) => [o.value, o.text]));
        const countByText = new Map<string, number>();
        for (const answer of answers) {
          for (const item of answer.answerList ?? []) {
            if (item.componentId !== comp.fe_id) continue;
            const vals = item.value ? item.value.split(',') : [];
            for (const v of vals) {
              const text = textByValue.get(v);
              if (!text) continue;
              countByText.set(text, (countByText.get(text) ?? 0) + 1);
            }
          }
        }
        const parts = [...countByText.entries()].map(
          ([text, count]) =>
            `${text}: ${count}（${Math.round((count / answerTotal) * 100)}%）`,
        );
        sections.push(
          `【第 ${questionIndex} 题】（${typeLabel}）${title}——共 ${answerTotal} 份答卷\n  ${parts.join(' | ')}`,
        );
      } else {
        // 开放题：复用预处理管道（每题限量 100 条去重）
        const { items, totalCount } = this._collectOpenTextAnswers(
          answers,
          comp.fe_id,
          100,
        );
        const lines = items
          .map(
            (item, i) =>
              `  ${i + 1}. ${JSON.stringify(item.text)}${item.repeat > 1 ? `（出现 ${item.repeat} 次）` : ''}`,
          )
          .join('\n');
        sections.push(
          `【第 ${questionIndex} 题】（${typeLabel}）${title}——有效答案 ${totalCount} 条${lines ? '\n' + lines : ''}`,
        );
      }
    }

    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: REPORT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `问卷标题：${question.title ?? ''}\n问卷描述：${question.desc ?? '无'}\n共 ${answerTotal} 份答卷。\n\n各题统计数据：\n${sections.join('\n')}`,
      },
    ];

    return await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      reportSchema,
    );
  }

  /**
   * AI 生成访谈提纲（纯生成，不落库）
   * 入参: username（登录态用户）、title（访谈标题）、desc（访谈描述）
   * 返回: { outline: string[] }
   */
  async generateInterviewOutline(
    username: string,
    title: string,
    desc: string,
  ): Promise<GenerateInterviewOutlineResult> {
    if (!title?.trim()) {
      throw new BadRequestException('请填写访谈标题');
    }
    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: INTERVIEW_OUTLINE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `访谈标题：${title.trim()}\n访谈描述：${desc?.trim() || '无'}\n请为以上访谈设计提纲。`,
      },
    ];

    return await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      generateInterviewOutlineSchema,
    );
  }

  /**
   * 校验访谈流式请求并准备流式上下文（纯生成，不落库）
   * 入参: questionId、history（完整对话记录，含当轮用户回答）
   * 返回: 流式闭包 (onDelta) => Promise<void>，供 controller 设置 SSE 头后调用
   * 错误: 400 参数不合法 / 不是访谈问卷 / 未发布 / 超轮次 / 创建者未配置；404 问卷不存在
   */
  async prepareInterviewStream(
    questionId: string,
    history: { role: string; content: string }[],
  ): Promise<(onDelta: (text: string) => void, signal?: AbortSignal) => Promise<boolean>> {
    if (!questionId?.trim()) {
      throw new BadRequestException('参数不合法');
    }
    const question = await this.questionService.findOne(questionId);
    if (!question) {
      throw new NotFoundException('问卷不存在');
    }
    if (question.type !== 'interview') {
      throw new BadRequestException('该问卷不是访谈问卷');
    }
    if (!question.isPublished) {
      throw new BadRequestException('该问卷尚未发布');
    }
    // 轮次上限 20：按受访者已回答轮次计数
    const answeredRounds = (history ?? []).filter((m) => m.role === 'interviewee').length;
    if (answeredRounds >= 20) {
      throw new BadRequestException('访谈已达轮次上限');
    }
    const { apiKey, baseUrl, model } = await this.requireAiConfig(question.author);

    const messages = this.buildInterviewMessages(question, history ?? []);
    const client = this.createClient(apiKey, baseUrl);

    return async (onDelta, signal) => {
      return await this.chatStream(client, model, messages, onDelta, signal);
    };
  }

  /**
   * AI 总结访谈答卷（整卷主题聚类 + 情感，纯生成，不落库）
   * 入参: username（登录态用户，须为问卷作者）、questionId
   * 返回: { summary, totalCount, themes, sentiment }（复用 summarizeAnswersSchema）
   * 错误: 400 参数不合法 / 不是访谈问卷 / 暂无访谈答卷 / 请先配置；403 非作者；404 问卷不存在
   */
  async summarizeInterview(
    username: string,
    questionId: string,
  ): Promise<SummarizeAnswersResult> {
    if (!questionId?.trim()) {
      throw new BadRequestException('参数不合法');
    }
    const question = await this.questionService.findOne(questionId);
    if (!question) {
      throw new NotFoundException('问卷不存在');
    }
    if (question.author !== username) {
      throw new ForbiddenException('无权操作该问卷');
    }
    if (question.type !== 'interview') {
      throw new BadRequestException('该问卷不是访谈问卷');
    }

    const total = await this.answerService.count(questionId);
    if (total === 0) {
      throw new BadRequestException('暂无访谈答卷');
    }
    const answers = await this.answerService.findAll(questionId, {
      page: 1,
      pageSize: total,
    });

    const { apiKey, baseUrl, model } = await this.requireAiConfig(username);

    const interviewTexts = answers
      .map((a, i) => {
        const lines = (a.conversationList ?? []).map(
          (m) => `${m.role === 'interviewer' ? '访谈员' : '受访者'}：${m.content}`,
        );
        return `【访谈 ${i + 1}】\n${lines.join('\n')}`;
      })
      .join('\n\n');

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: INTERVIEW_SUMMARY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `访谈主题：${question.title ?? ''}\n共 ${total} 份访谈答卷。\n\n${interviewTexts}`,
      },
    ];

    return await this.chatWithRetry(
      this.createClient(apiKey, baseUrl),
      model,
      messages,
      summarizeAnswersSchema,
    );
  }

  // 组织访谈对话的 messages：system 含主题/提纲/规则，user 含对话历史或开场指令
  private buildInterviewMessages(
    question: {
      title: string;
      desc?: string;
      interviewConfig?: { outline: string[] };
    },
    history: { role: string; content: string }[],
  ): ChatCompletionMessageParam[] {
    const outline = question.interviewConfig?.outline ?? [];
    const systemContent = `你是专业的 AI 访谈员，负责对受访者进行一对一访谈。

【访谈主题】
标题：${question.title ?? ''}
描述：${question.desc || '无'}

【访谈提纲】（按顺序逐题引导，可结合回答适当追问）
${outline.length > 0 ? outline.map((q, i) => `${i + 1}. ${q}`).join('\n') : '（无提纲，请围绕访谈主题自然提问）'}

【访谈规则】
- 一次只问一个问题，等受访者回答后再继续
- 按提纲顺序推进，提纲问完后做简短总结并礼貌结束
- 提纲问完并完成收尾总结后，在回复末尾输出 [[END]] 标记（不要输出任何其他内容）
- 结合受访者回答适当追问细节，但不偏离主题
- 语气自然、友善、口语化，使用简体中文
- 不要重复已经问过的问题`;

    const historyText = history
      .map((m) => `${m.role === 'interviewer' ? '访谈员' : '受访者'}：${m.content}`)
      .join('\n');
    const userContent =
      history.length === 0
        ? '请开始访谈：先做简短自我介绍，然后提出第一个问题。'
        : `以下是当前访谈对话记录：\n${historyText}\n\n请继续访谈，提出下一个问题。`;

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];
  }

  // 流式调用 LLM：逐 chunk 回调增量文本（访谈用，非 JSON 模式）
  // 检测结束标记 [[END]]（提纲问完收尾后 AI 输出），剥离标记并返回是否结束
  private async chatStream(
    client: OpenAI,
    model: string,
    messages: ChatCompletionMessageParam[],
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const END_MARK = '[[END]]';
    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
    }, { signal });
    // 客户端断开（signal abort）时打日志，标记上游请求被中止
    signal?.addEventListener('abort', () => {
      new Logger('InterviewStream').log('上游 LLM 请求已中止');
    });

    let buffer = '';
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (!delta) continue;
        buffer += delta;

        const idx = buffer.indexOf(END_MARK);
        if (idx !== -1) {
          const before = buffer.slice(0, idx);
          if (before) onDelta(before);
          return true;
        }

        // 保留末尾最多 END_MARK.length-1 个字符，防止结束标记被 chunk 截断
        const safeLen = Math.max(0, buffer.length - (END_MARK.length - 1));
        if (safeLen > 0) {
          onDelta(buffer.slice(0, safeLen));
          buffer = buffer.slice(safeLen);
        }
      }
    } catch (err) {
      // 客户端断开导致上游请求中止：静默返回，不再向上抛（res 已关闭）
      if (signal?.aborted) {
        return false;
      }
      throw err;
    }
    if (buffer) {
      onDelta(buffer);
    }
    return false;
  }

  // 开放题答案预处理管道（summarizeAnswers 与 analyzeReport 共用）：
  // trim 过滤空串 → 相同文本合并计数（order 记最后一次出现顺序，取最新）→ 限量 → 每条截 200 字
  // totalCount 含重复（与统计页口径一致）；items 为去重后的限量条目
  private _collectOpenTextAnswers(
    answers: { answerList?: { componentId: string; value: string }[] }[],
    componentId: string,
    limit: number,
  ): { items: { text: string; repeat: number }[]; totalCount: number } {
    // key=答案原文；order 记录最后一次出现的顺序（越大越新），用于"取最新"
    const merged = new Map<string, { text: string; repeat: number; order: number }>();
    let order = 0;
    for (const answer of answers) {
      for (const item of answer.answerList ?? []) {
        if (item.componentId !== componentId) continue;
        const text = (item.value ?? '').trim();
        if (!text) continue;
        order++;
        const existing = merged.get(text);
        if (existing) {
          existing.repeat++;
          existing.order = order;
        } else {
          merged.set(text, { text, repeat: 1, order });
        }
      }
    }

    const totalCount = [...merged.values()].reduce(
      (sum, item) => sum + item.repeat,
      0,
    );
    const items = [...merged.values()]
      .sort((a, b) => b.order - a.order)
      .slice(0, limit)
      .map((item) => ({ text: item.text.slice(0, 200), repeat: item.repeat }));

    return { items, totalCount };
  }

  // 读取用户 AI 配置，未配置时抛出带引导的 400
  private async requireAiConfig(username: string) {
    const user = await this.userService.findByUsername(username);
    if (!user?.aiConfig) {
      throw new BadRequestException('请先配置 AI 模型（API Key），在顶部昵称菜单 → AI 设置中完成');
    }
    return user.aiConfig;
  }

  // 按用户配置动态创建 client（用户自带 Key，各自独立）
  private createClient(apiKey: string, baseUrl: string) {
    return new OpenAI({ apiKey, baseURL: baseUrl, timeout: 55_000 });
  }

  // 调用 LLM → 解析 JSON → zod 校验，失败把错误反馈给模型重试 1 次（生成问卷与单题优化共用）
  private async chatWithRetry<T>(
    client: OpenAI,
    model: string,
    messages: ChatCompletionMessageParam[],
    schema: z.ZodType<T>,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: string;
      try {
        const completion = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          response_format: { type: 'json_object' },
        });
        raw = completion.choices[0]?.message?.content ?? '';
      } catch (err) {
        throw this.mapLlmError(err);
      }

      const json = this.parseJson(raw);
      if (json === null) {
        lastError = new Error('输出不是合法 JSON');
        continue;
      }

      const parsed = schema.safeParse(json);
      if (parsed.success) {
        return parsed.data;
      }
      lastError = new Error(parsed.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; '));
      // 把校验错误反馈给模型，提高重试成功率
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `你的输出不符合要求：${lastError.message}。请严格按契约重新输出完整 JSON。`,
      });
    }

    throw new ServiceUnavailableException(`AI 生成的内容格式不符合要求，请重试（原因：${lastError?.message ?? '未知'}）`);
  }

  // 解析模型输出，容忍 ```json 包裹
  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      const matched = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (matched) {
        try {
          return JSON.parse(matched[1]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  // 将 LLM 错误映射为对用户有明确指引的中文提示
  private mapLlmError(err: unknown): Error {
    if (err instanceof AuthenticationError) {
      return new BadRequestException('API Key 无效，请到「AI 设置」检查后重新保存');
    }
    if (err instanceof APIConnectionTimeoutError) {
      return new ServiceUnavailableException('AI 请求超时，请稍后重试');
    }
    // 部分供应商对余额不足返回 400/429 且信息在 message 中，尽量透传
    if (err instanceof BadRequestError) {
      return new BadRequestException(`AI 请求失败：${err.message}，请检查「AI 设置」中的 Key、baseUrl、模型及余额`);
    }
    if (err instanceof Error) {
      return new ServiceUnavailableException(`AI 请求失败：${err.message}`);
    }
    return new ServiceUnavailableException('AI 请求失败，请稍后重试');
  }

  // 重写 radio options / checkbox list 的 value 为 itemN（统计聚合 key 铁律）
  private normalizeOptions(type: string, props: Record<string, unknown>) {
    if (type === 'questionRadio' && Array.isArray(props.options)) {
      props.options = (props.options as Array<{ text: string }>).map((item, i) => ({
        value: `item${i + 1}`,
        text: item.text,
      }));
    }
    if (type === 'questionCheckbox' && Array.isArray(props.list)) {
      props.list = (props.list as Array<{ text: string }>).map((item, i) => ({
        value: `item${i + 1}`,
        text: item.text,
        checked: false,
      }));
    }
  }

  // 规范化：补 fe_id / title / isHidden / isLocked，重写 options/list 的 value
  private normalize(result: GenerateQuestionResult) {
    const componentList: NormalizedComponent[] = result.componentList.map(c => {
      const props = c.props as Record<string, unknown>;
      this.normalizeOptions(c.type, props);

      // 题目类组件用题干做图层标题，其他用固定标签
      const title =
        typeof props.title === 'string' && props.title
          ? props.title
          : COMPONENT_LABELS[c.type] ?? c.type;

      return {
        fe_id: nanoid(),
        type: c.type,
        title,
        isHidden: false,
        isLocked: false,
        props,
      };
    });

    return { title: result.title, desc: result.desc, componentList };
  }
}
