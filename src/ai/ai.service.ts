import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { APIConnectionTimeoutError, AuthenticationError, BadRequestError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { UserService } from '../user/user.service.js';
import {
  generateQuestionSchema,
  componentSchema,
  propsSchemas,
  type GenerateQuestionResult,
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

@Injectable()
export class AiService {
  constructor(private readonly userService: UserService) { }

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
        content: `请优化以下问卷组件：\n${JSON.stringify({ type, props })}${
          instruction?.trim() ? `\n\n优化要求：${instruction.trim()}` : ''
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
