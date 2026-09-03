import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, HttpException, HttpStatus } from '@nestjs/common';
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
  type GenerateQuestionResult,
  type TranslateQuestionResult,
  type SummarizeAnswersResult,
  type ReportResult,
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

// 对话式问卷的客户端消息（前端组装，服务端逐条校验后才进入提示词）
type ChatMsg = { role: 'assistant' | 'user'; content: string };

// SSE 流式下发项（delta 正文 / meta 标记指令 / error 流中错误）
type ChatStreamItem = {
  delta?: string;
  meta?: { skip?: number; end?: boolean; stay?: boolean };
  error?: string;
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

const CHAT_SYSTEM_PROMPT = `你是亲切的问卷访谈员，正在与答卷人逐题对话完成问卷。

【任务】
根据提供的问卷题目列表与对话进展，发出下一句问话。一次只问一题。

【规则】
- 用自然、亲切的口吻提问；单选/多选题可自然地列出选项供用户选择
- 可结合对话中已出现的回答做简短衔接（如"刚才你提到……"），但不要复述全部历史
- 指定的"当前待问"题目若用户刚回答过：可就其答案追问一次（答案过于简短时引导补充），追问的回复以 [[STAY]] 结尾；无需追问则直接问之后的题目
- 追问仅限开放题（单行/多行输入），其他题型不要追问
- 认为剩余题目都无需再问时，回复一句自然的收尾语并以 [[END]] 结尾
- 建议用户跳过当前非必答题时，回复以 [[SKIP:1]] 结尾
- 标记（[[STAY]] / [[END]] / [[SKIP:n]]）只能出现在回复最末尾，一次最多一个；除此之外不要输出任何标记、代号或 JSON
- 必答题（题目列表标注[必答]）不得建议跳过
- 全部使用简体中文`;

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

  // ============ 对话式问卷（C 端匿名访问，用问卷作者的 AI 配置）============

  // 匿名限流：questionId+IP 滑动窗口（60s / 30 次），超出抛 429
  private rateLimitMap = new Map<string, { count: number; windowStart: number }>();

  checkRateLimit(questionId: string, ip: string) {
    if (!questionId) return; // 无效参数交给后续校验报 400
    const key = `${questionId}:${ip}`;
    const now = Date.now();
    const entry = this.rateLimitMap.get(key);
    // 惰性重置：窗口过期即重新计数；Map 不做定时清理（问卷量级下内存可忽略）
    if (!entry || now - entry.windowStart > 60_000) {
      this.rateLimitMap.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count++;
    if (entry.count > 30) {
      throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * C 端问卷页判断是否展示"AI 对话模式"入口（@Public）
   * chatEnabled = 已发布 && 未删除 && 作者已配置 AI && 无译文（对话仅支持主版本中文）
   */
  async isChatEnabled(questionId: string) {
    if (!questionId?.trim()) {
      throw new BadRequestException('参数不合法');
    }
    const question = await this.questionService.findOne(questionId);
    if (!question || question.isDeleted || !question.isPublished) {
      return { chatEnabled: false };
    }
    if (question.translations && Object.keys(question.translations).length > 0) {
      return { chatEnabled: false };
    }
    const author = await this.userService.findByUsername(question.author);
    return { chatEnabled: !!author?.aiConfig };
  }

  /**
   * 对话式问卷一轮请求的校验与上下文组装（可抛 HTTP 异常的部分全部在此，
   * controller 在写 SSE 头之前调用；LLM 调用由 streamChat 负责）
   * 入参: questionId / componentId（当前停留题 fe_id）/ messages（前端维护的对话记录）
   * 返回: { client, model, messages }——llm 消息由服务端按问卷数据重组，不透传原始 messages
   */
  async prepareChat(questionId: string, componentId: string, messages: unknown) {
    if (!questionId?.trim() || !componentId?.trim() || !Array.isArray(messages)) {
      throw new BadRequestException('参数不合法');
    }

    const question = await this.questionService.findOne(questionId);
    if (!question || question.isDeleted) {
      throw new NotFoundException('问卷不存在');
    }
    if (!question.isPublished) {
      throw new BadRequestException('问卷尚未发布');
    }

    // 进入对话流程的仅 4 种题型（结构组件无作答）
    const visible = (question.componentList ?? []).filter(
      (c) =>
        !c.isHidden &&
        ['questionRadio', 'questionCheckbox', 'questionInput', 'questionTextarea'].includes(c.type),
    );
    if (visible.length === 0) {
      throw new BadRequestException('该问卷没有可对话的题目');
    }

    // 逐条校验消息（最近 20 条），user 消息的 [答:fe_id=value]/[跳:fe_id] 前缀按问卷数据核验
    const chatMsgs: ChatMsg[] = [];
    const answers = new Map<string, string>();
    const skipped = new Set<string>();
    for (const raw of messages.slice(-20)) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('消息数据不合法');
      }
      const { role, content } = raw as { role?: unknown; content?: unknown };
      if (role !== 'assistant' && role !== 'user') {
        throw new BadRequestException('消息数据不合法');
      }
      if (typeof content !== 'string' || !content.trim()) {
        throw new BadRequestException('消息数据不合法');
      }
      const text = content.slice(0, 500);
      if (role === 'user') {
        const answerMatch = text.match(/^\[答:([^=\]]+)=([^\]]*)\]/);
        const skipMatch = text.match(/^\[跳:([^\]]+)\]/);
        if (answerMatch) {
          const [, feId, value] = answerMatch;
          const comp = visible.find((c) => c.fe_id === feId);
          if (!comp) throw new BadRequestException('消息数据不合法');
          if (comp.type === 'questionRadio') {
            const opts = (comp.props as { options?: { value: string }[] }).options ?? [];
            if (!opts.some((o) => o.value === value)) {
              throw new BadRequestException('消息数据不合法');
            }
          } else if (comp.type === 'questionCheckbox') {
            const list = (comp.props as { list?: { value: string }[] }).list ?? [];
            const vals = value.split(',');
            if (!value || !vals.every((v) => list.some((o) => o.value === v))) {
              throw new BadRequestException('消息数据不合法');
            }
          } else if (!value.trim()) {
            throw new BadRequestException('消息数据不合法');
          }
          answers.set(feId, value);
        } else if (skipMatch) {
          const comp = visible.find((c) => c.fe_id === skipMatch[1]);
          if (!comp || comp.isLocked) {
            throw new BadRequestException('消息数据不合法');
          }
          skipped.add(skipMatch[1]);
        }
        // 无前缀的 user 消息放行（仅作对话上下文，不影响服务端推导的已答状态）
      }
      chatMsgs.push({ role, content: text });
    }

    const curIndex = visible.findIndex((c) => c.fe_id === componentId);
    if (curIndex === -1) {
      throw new BadRequestException('参数不合法');
    }

    // 组装 user prompt：题目列表（含服务端推导的作答状态）+ 对话记录 + 当前任务
    const typeLabels: Record<string, string> = {
      questionRadio: '单选',
      questionCheckbox: '多选',
      questionInput: '单行输入',
      questionTextarea: '多行输入',
    };
    const lines = visible.map((c, i) => {
      const title = (c.props as { title?: string }).title ?? '';
      let optTexts = '';
      if (c.type === 'questionRadio') {
        const opts = (c.props as { options?: { text: string }[] }).options ?? [];
        if (opts.length) optTexts = ` 选项: ${opts.map((o) => o.text).join('/')}`;
      } else if (c.type === 'questionCheckbox') {
        const list = (c.props as { list?: { text: string }[] }).list ?? [];
        if (list.length) optTexts = ` 选项: ${list.map((o) => o.text).join('/')}`;
      }
      const status = answers.has(c.fe_id)
        ? `已答: ${answers.get(c.fe_id)}`
        : skipped.has(c.fe_id)
          ? '已跳过'
          : '待问';
      return `${i + 1}. [${typeLabels[c.type]}][${c.isLocked ? '必答' : '选答'}] ${title}${optTexts} —— ${status}`;
    });

    // 当前停留题已答 = 追问判定轮（用户刚答过此题）；未答 = 正常问此题
    const taskLine = answers.has(componentId)
      ? `当前待问: 第 ${curIndex + 1} 题（用户刚回答过，可就其答案追问一次并以 [[STAY]] 结尾，或直接问之后的题目；若剩余题目都无需再问，以 [[END]] 结尾收尾）`
      : `当前待问: 第 ${curIndex + 1} 题，请开始问这一题`;

    const history = chatMsgs
      .map((m) => `${m.role === 'assistant' ? '访谈员' : '答卷人'}: ${m.content}`)
      .join('\n');

    const userPrompt = `问卷标题: ${question.title ?? ''}\n\n题目列表:\n${lines.join('\n')}\n\n对话记录:\n${history || '（无）'}\n\n${taskLine}`;

    const { apiKey, baseUrl, model } = await this.requireAuthorAiConfig(question);
    return {
      client: this.createClient(apiKey, baseUrl),
      model,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ] as ChatCompletionMessageParam[],
    };
  }

  /**
   * 对话式问卷的流式调用：LLM 输出经标记解析状态机后逐段产出
   * delta（正文）/ meta（STAY/END/SKIP 指令）；供应商不支持 stream 时降级一次性返回。
   * 流中错误不抛异常（SSE 响应已开始），以 error 项下发
   */
  async *streamChat(
    client: OpenAI,
    model: string,
    messages: ChatCompletionMessageParam[],
  ): AsyncGenerator<ChatStreamItem> {
    let buffer = '';
    let pendingMeta: NonNullable<ChatStreamItem['meta']> | undefined;

    const parseMeta = (token: string): NonNullable<ChatStreamItem['meta']> | null => {
      if (token === '[[END]]') return { end: true };
      if (token === '[[STAY]]') return { stay: true };
      const m = token.match(/^\[\[SKIP:(\d+)\]\]$/);
      if (m) return { skip: Number(m[1]) };
      return null;
    };

    // 从 buffer 头部安全切出可下发正文；疑似标记的部分 hold 住等待闭合
    const emitSafe = (): string => {
      const idx = buffer.indexOf('[[');
      if (idx === -1) {
        const out = buffer;
        buffer = '';
        return out;
      }
      const out = buffer.slice(0, idx);
      const rest = buffer.slice(idx);
      const closeIdx = rest.indexOf(']]');
      if (closeIdx === -1) {
        // 未闭合：短则 hold 等待更多 chunk，过长则判定为正文（标记最长 [[SKIP:99]]）
        if (rest.length > 20) {
          buffer = rest.slice(1);
          return out + '[';
        }
        buffer = rest;
        return out;
      }
      const token = rest.slice(0, closeIdx + 2);
      const meta = parseMeta(token);
      if (meta) {
        pendingMeta = meta;
        buffer = rest.slice(closeIdx + 2);
        return out;
      }
      // 形如 [[xx]] 但不是合法标记：'[[' 作为正文
      buffer = rest.slice(2);
      return out + '[[';
    };

    try {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          stream: true,
        });
        for await (const chunk of stream) {
          buffer += chunk.choices[0]?.delta?.content ?? '';
          const safe = emitSafe();
          if (safe) yield { delta: safe };
        }
      } catch (err) {
        // 个别供应商不支持 stream 参数：降级为非流式，全文当一个 delta（前端无需感知）
        if (err instanceof BadRequestError && /stream/i.test(String(err.message))) {
          const completion = await client.chat.completions.create({
            model,
            messages,
            temperature: 0.7,
          });
          buffer = completion.choices[0]?.message?.content ?? '';
          const safe = emitSafe();
          if (safe) yield { delta: safe };
        } else {
          throw err;
        }
      }

      // 流结束：处理 buffer 残余（可能是闭合的标记 + 尾随正文）
      if (buffer) {
        const m = buffer.match(/^\[\[(SKIP:\d+|END|STAY)\]\]/);
        if (m) {
          pendingMeta = parseMeta(m[0]) ?? pendingMeta;
          const rest = buffer.slice(m[0].length);
          if (rest) yield { delta: rest };
        } else {
          yield { delta: buffer };
        }
        buffer = '';
      }
      if (pendingMeta) yield { meta: pendingMeta };
    } catch (err) {
      yield { error: this.mapLlmError(err).message };
    }
  }

  // 取问卷作者的 AI 配置（对话式问卷匿名使用作者 Key；问卷状态校验由调用方完成）
  private async requireAuthorAiConfig(question: {
    author: string;
  }) {
    const author = await this.userService.findByUsername(question.author);
    if (!author?.aiConfig) {
      throw new BadRequestException('该问卷未开启 AI 对话');
    }
    return author.aiConfig;
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
