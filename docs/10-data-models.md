# 10 - 数据模型

> 模块内 Schema 文件：[user.schema.ts](../../src/user/schemas/user.schema.ts) · [question.schema.ts](../../src/question/schemas/question.schema.ts) · [answer.schema.ts](../../src/answer/schemas/answer.schema.ts)
> 数据库：MongoDB（默认 `nestdb`），三个集合：`users` / `questions` / `answers`。

## 1. users 集合 — User / AiConfig

```ts
// 用户自带的 AI 模型配置（嵌套文档需独立 @Schema 类，
// 否则 @nestjs/mongoose 无法从内联对象类型反射推断结构）
@Schema()
export class AiConfig {
  @Prop({ required: true })
  apiKey: string;    // 明文仅存库，任何回显场景打码

  @Prop({ required: true })
  baseUrl: string;   // 必须 https:// 开头（Service 校验）

  @Prop({ required: true })
  model: string;
}

@Schema({ timestamps: true })   // 自动维护 createdAt / updatedAt
export class User {
  @Prop({ required: true, unique: true })
  username: string;   // 唯一索引，登录名

  @Prop({ required: true })
  password: string;   // bcrypt 哈希（cost 10），不存明文

  @Prop()
  nickname: string;   // 显示昵称

  @Prop({ type: AiConfig })
  aiConfig?: AiConfig;  // BYOK 配置，未配置时无此字段
}
```

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| username | string | required + unique | 登录名 / 问卷 author 关联键 |
| password | string | required | bcrypt 哈希 |
| nickname | string | - | 昵称 |
| aiConfig | AiConfig | 可选 | `{ apiKey, baseUrl, model }` |
| createdAt / updatedAt | Date | 自动 | timestamps |

## 2. questions 集合 — Question / InterviewConfig / 译文

```ts
// 访谈配置（嵌套文档需独立 @Schema 类，避免内联对象触发 CannotDetermineTypeError）
@Schema()
export class InterviewConfig {
  @Prop({ type: [String], default: [] })
  outline: string[];   // 访谈提纲（AI 生成或手工编辑）
}

@Schema({ timestamps: true })
export class Question {
  @Prop({ required: true })
  title: string;

  @Prop()
  desc: string;

  @Prop()
  js: string;          // 页面自定义脚本（问卷增强）

  @Prop()
  css: string;         // 页面自定义样式

  @Prop({ default: false })
  isPublished: boolean;  // 发布状态（C 端可见）

  @Prop({ default: false })
  isStar: boolean;       // 标星

  @Prop({ default: false })
  isDeleted: boolean;    // 回收站标记（软删）

  @Prop({ default: 0 })
  answerCount: number;   // 反范式答卷计数（提交答卷时 $inc 维护）

  @Prop({ required: true })
  author: string;        // 归属用户名（非引用 id）

  @Prop({ default: 'survey' })
  type: 'survey' | 'interview';  // 问卷类型

  @Prop({ type: InterviewConfig })
  interviewConfig?: InterviewConfig;  // 仅 interview 类型使用

  @Prop()
  componentList: { /* 见下方组件契约 */ }[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  translations?: { [lang: string]: QuestionTranslation };  // 多语言译文
}

// 高频访问路径：按作者查列表 + 回收站过滤 + 倒序分页（findAllList/countAll 共用）
QuestionSchema.index({ author: 1, isDeleted: 1, _id: -1 });
```

### 2.1 译文相关接口（类型层）

```ts
// 单个组件的文案译文（按 fe_id 索引，仅含该组件类型有文案值的字段）
export interface ComponentTextTranslation {
  title?: string;
  desc?: string;
  text?: string;
  placeholder?: string;
  options?: string[];  // questionRadio 选项 text 数组，顺序与主版本一致
  list?: string[];     // questionCheckbox 选项 text 数组，顺序与主版本一致
}

// 单个语言的整卷译文：只存"文案差异"，不存结构；
// fe_id 未命中时 C 端回退主版本文案
export interface QuestionTranslation {
  title: string;
  desc: string;
  texts: { [fe_id: string]: ComponentTextTranslation };
}
```

### 2.2 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| title / desc | string | 问卷标题 / 描述 |
| js / css | string | 自定义脚本 / 样式 |
| isPublished | boolean | 发布后 C 端可填写（访谈流校验依据） |
| isStar / isDeleted | boolean | 标星 / 回收站（列表筛选维度） |
| answerCount | number | 反范式计数，避免列表页聚合 |
| author | string | 用户名字符串（非 ObjectId 引用） |
| type | `'survey' \| 'interview'` | 两种业务形态 |
| interviewConfig.outline | string[] | 访谈提纲 |
| componentList | array | 问卷组件树（见下节） |
| translations | Mixed | `{ en/ja/ko/fr/es/ru: QuestionTranslation }` |

## 3. answers 集合 — Answer / AnswerUsage

```ts
// 单次访谈的 token 用量（嵌套文档需独立 @Schema 类，避免内联对象类型推断错误）
@Schema()
export class AnswerUsage {
  @Prop({ required: true })
  prompt: number;

  @Prop({ required: true })
  completion: number;

  @Prop({ required: true })
  total: number;
}

@Schema({ timestamps: true })
export class Answer {
  @Prop({ required: true })
  questionId: string;          // 关联问卷 _id（字符串）

  @Prop()
  answerList?: {               // 问卷答卷（survey）
    componentId: string;       // 组件 fe_id
    value: string;             // 单选 'item1' / 多选 'item1,item3' / 填空原文
  }[];

  @Prop()
  conversationList?: {         // 访谈对话记录（interview）
    role: 'interviewer' | 'interviewee';
    content: string;
  }[];

  @Prop({ type: AnswerUsage })
  usage?: AnswerUsage;         // 访谈 token 用量
}

// 高频访问路径：按问卷查询答卷并按创建时间倒序分页（count/findAll 共用）
AnswerSchema.index({ questionId: 1, createdAt: -1 });
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| questionId | string | 问卷 _id |
| answerList | array | 问卷答卷项（与 conversationList 至少其一） |
| conversationList | array | 访谈多轮对话 |
| usage | AnswerUsage | `{ prompt, completion, total }` token 统计 |
| createdAt / updatedAt | Date | 答卷时间（分页倒序依据） |

## 4. 问卷组件契约（componentList 单项）

`componentList` 是问卷的核心结构，单项形态：

```ts
{
  fe_id: string        // nanoid 生成的前端组件 id（答卷/译文/统计的关联键）
  type: string         // 7 种组件类型之一
  title: string        // 图层面板显示标题
  isHidden: boolean    // 隐藏（C 端不渲染，统计不收录）
  isLocked: boolean    // 锁定（编辑器中不可移动）
  props: object        // 类型相关的属性（契约如下）
}
```

### 7 种组件类型与 props 契约

| type | 名称 | props 契约 |
| --- | --- | --- |
| `questionInfo` | 问卷信息 | `{ title, desc }`（每份问卷开头必须且只能有一个） |
| `questionTitle` | 分组小标题 | `{ text, level: 1~5, isCenter }` |
| `questionParagraph` | 说明段落 | `{ text, isCenter }` |
| `questionInput` | 单行填空 | `{ title, placeholder }` |
| `questionTextarea` | 多行填空 | `{ title, placeholder }` |
| `questionRadio` | 单选题 | `{ title, isVertical, options: { value, text }[] }`（2~6 项） |
| `questionCheckbox` | 多选题 | `{ title, isVertical, list: { value, text, checked }[] }`（3~8 项） |

### value = itemN 铁律

单选/多选选项的 `value` 统一为 `item1..itemN`（AI 生成与人工创建均由后端规范化）：

- 统计聚合以 value 为 key（`aggregateComponentStat` 的 `$group`），文案（text）变更不影响历史答卷统计。
- 多选答案在 C 端以逗号拼接存储（如 `'item1,item3'`），聚合时 `$split` 拆开逐项计数。

## 5. 索引设计

| 集合 | 索引 | 支撑的查询 |
| --- | --- | --- |
| users | `{ username: 1 }` unique | 登录 / profile / AI 配置读取 |
| questions | `{ author: 1, isDeleted: 1, _id: -1 }` | 列表分页（作者 + 回收站过滤 + 倒序） |
| answers | `{ questionId: 1, createdAt: -1 }` | 答卷分页 / 计数 |

## 6. Mongoose 建模注意事项（项目内注释沉淀的经验）

- **嵌套文档必须独立 `@Schema` 类**：内联对象类型（如 `aiConfig: { ... }`）会触发 `CannotDetermineTypeError`，`User.aiConfig`、`Question.interviewConfig`、`Answer.usage` 均因此独立成类。
- **无固定结构的嵌套用 `Mixed`**：`Question.translations` 的 key 为动态语言码，用 `MongooseSchema.Types.Mixed` 文档化足够。
- **timestamps: true**：三个集合均自动维护 `createdAt/updatedAt`。

## 7. 相关文档

- [06 - 问卷模块](./06-question-module.md)
- [07 - 答卷模块](./07-answer-module.md)
