# 06 - 问卷模块（Question）

> 源码目录：[src/question/](../../src/question/)
> 职责：问卷与访谈的创建、查询（分页/筛选）、更新（字段白名单）、删除、复制、多语言译文管理。是平台的聚合根模块。

## 1. 模块组成 — [question.module.ts](../../src/question/question.module.ts)

```ts
@Module({
  imports: [MongooseModule.forFeature([{ name: Question.name, schema: QuestionSchema }])],
  exports: [QuestionService],   // 供 StatModule / AiModule 消费
  controllers: [QuestionController],
  providers: [QuestionService],
})
```

## 2. 接口 — [question.controller.ts](../../src/question/question.controller.ts)

所有路由均带全局前缀 `/api/question`。

| 方法     | 路径                               | 鉴权          | 说明                                                        |
| ------ | -------------------------------- | ----------- | --------------------------------------------------------- |
| POST   | `/api/question`                  | 需登录         | 创建问卷，Body `{ type?: 'survey' \| 'interview' }`（默认 survey） |
| GET    | `/api/question`                  | 需登录         | 我的问卷列表（分页 + 筛选）                                           |
| GET    | `/api/question/:id`              | `@Public()` | 问卷详情（C 端匿名填写用）                                            |
| PATCH  | `/api/question/:id`              | 需登录（作者）     | 更新问卷（字段白名单）                                               |
| PUT    | `/api/question/:id/translations` | 需登录（作者）     | 保存某语言整卷译文                                                 |
| DELETE | `/api/question/:id`              | 需登录（作者）     | 删除单份问卷                                                    |
| DELETE | `/api/question`                  | 需登录（作者）     | 批量删除，Body `{ ids: string[] }`                             |
| POST   | `/api/question/duplicate/:id`    | 需登录         | 复制问卷（副本归属当前用户）                                            |

### 列表查询参数（GET /api/question）

| Query 参数    | 类型              | 默认    | 说明                            |
| ----------- | --------------- | ----- | ----------------------------- |
| `keyword`   | string          | -     | 标题模糊匹配（忽略大小写正则）               |
| `page`      | number          | 1     | 页码                            |
| `pageSize`  | number          | 10    | 每页条数                          |
| `isDeleted` | boolean         | false | 是否回收站视图                       |
| `isStar`    | boolean \| null | null  | null=全部 / true=标星 / false=未标星 |

返回：`{ list: Question[], count: number }`。列表强制 `author = 当前用户`，按 `_id` 倒序。

## 3. 关键类与函数 — [question.service.ts](../../src/question/question.service.ts)

### 常量

```ts
// 允许更新的问卷字段白名单：body 只取这些字段入库，
// 防止客户端注入 author / _id 等字段篡改归属或写入脏数据
static readonly UPDATABLE_FIELDS = [
  'title', 'desc', 'js', 'css', 'isPublished', 'isStar', 'isDeleted',
  'componentList', 'type', 'interviewConfig',
] as const;

// 支持的语言码白名单（与前端语言下拉一致，防脏 key 写入 translations）
static readonly TRANSLATION_LANGS = ['en', 'ja', 'ko', 'fr', 'es', 'ru'] as const;
```

### `create(username: string, type: 'survey' | 'interview' = 'survey')`

按类型创建两种初始结构：

* **survey**：默认标题「问卷标题 + 时间戳」，`componentList` 预置一个 `questionInfo` 组件（`fe_id = nanoid()`）。

* **interview**：默认标题「访谈标题 + 时间戳」，`componentList` 为空数组，`interviewConfig = { outline: [] }`。

### `update(id: string, updateData: QuestionDto, author: string)`

```ts
async update(id: string, updateData: QuestionDto, author: string) {
  const $set: Partial<Record<(typeof QuestionService.UPDATABLE_FIELDS)[number], unknown>> = {};
  for (const key of QuestionService.UPDATABLE_FIELDS) {
    if (updateData[key] !== undefined) {
      $set[key] = updateData[key];
    }
  }
  return await this.questionModel.updateOne({ _id: id, author }, { $set });
}
```

* 只提交 body 中**存在**的白名单字段（`$set` 局部更新）。

* 查询条件含 `author`，非作者的更新匹配 0 条，**静默 no-op**（不报错）。

### `updateTranslations(id, author, lang, translation)`

保存某语言整卷译文（PUT /:id/translations）：

```ts
if (!TRANSLATION_LANGS.includes(lang)) throw new BadRequestException('不支持的目标语言');
if (!translation || typeof translation !== 'object' || !translation.texts) {
  throw new BadRequestException('译文数据不合法');
}
const res = await this.questionModel.updateOne(
  { _id: id, author },
  { $set: { [`translations.${lang}`]: translation } },  // 动态 key：translations.en 等
  { timestamps: true },
);
if (res.matchedCount === 0) {
  throw new ForbiddenException('无权操作该问卷');  // 新接口无历史包袱：非作者显式 403
}
```

译文结构（`QuestionTranslation`）：

```ts
{
  title: string        // 问卷标题译文
  desc: string         // 问卷描述译文
  texts: {             // 按 fe_id 索引的组件文案差异
    [fe_id: string]: {
      title?: string
      desc?: string
      text?: string
      placeholder?: string
      options?: string[]   // 单选选项文案（顺序与主版本一致）
      list?: string[]      // 多选选项文案（顺序与主版本一致）
    }
  }
}
```

> 设计：只存「文案差异」不存结构，fe\_id 未命中时 C 端回退主版本文案；同一语言已有译文则整体覆盖。

### `findAllList(params: QuestionSearchParams) / countAll(params)`

列表查询与计数共用同一套 where 构建（`author + isDeleted [+ isStar] [+ title 正则]`）：

* `findAllList`：`find().sort({ _id: -1 }).skip((page-1)*pageSize).limit(pageSize)`，返回 `toObject()` 后的数组。

* `countAll`：`countDocuments(whereOpt)`，供分页总数。

### `delete(id, author) / deleteMany(ids, author)`

物理删除，查询条件均含 `author`（非作者删除静默 no-op）。

> 项目用「回收站」语义：前端先把问卷 `isDeleted` 置 true（PATCH），回收站里再物理删除。

### `duplicate(id: string, author: string)`

复制问卷：

```ts
const newQuestion = new this.questionModel({
  ...question.toObject(),
  _id: new Types.ObjectId(),
  title: question.title + '副本',
  author,                        // 副本归属操作者（可复制他人已发布问卷）
  isPublished: false,            // 副本强制未发布
  isStar: false,
  answerCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  translations: undefined,       // 复制时全量重新生成 fe_id，译文不继承
  componentList: question.componentList.map((item) => ({
    ...item,
    fe_id: nanoid(),             // 全量重新生成 fe_id
  })),
});
```

问卷不存在时抛 404「问卷不存在」。

### `findOne(id: string)`

按 id 查详情（公开接口，C 端匿名获取问卷渲染填报表单 / 访谈对话）。

## 4. DTO — [question.dto.ts](../../src/question/dto/question.dto.ts)

`QuestionDto` 与 `QuestionService.UPDATABLE_FIELDS` 白名单一一对应（全部可选）：

```ts
export class QuestionDto {
  readonly title?: string;
  readonly desc?: string;
  readonly js?: string;
  readonly css?: string;
  readonly isPublished?: boolean;
  readonly isStar?: boolean;
  readonly isDeleted?: boolean;
  readonly componentList?: Question['componentList'];
  readonly type?: Question['type'];
  readonly interviewConfig?: Question['interviewConfig'];
}
```

## 5. 数据模型

`Question` / `InterviewConfig` Schema 及索引详见 [10 - 数据模型](./10-data-models.md)。

## 6. 依赖关系

```text
QuestionController ──► QuestionService ──► QuestionModel（Mongoose）
StatService（StatModule）────────────────► QuestionService.findOne
AiService（AiModule）────────────────────► QuestionService.findOne
AnswerModule（直接注册 QuestionModel）───► QuestionModel.$inc(answerCount)
```

## 7. 相关文档

* [10 - 数据模型](./10-data-models.md)

* [09 - AI 模块](./09-ai-module.md)（译文由 AI 翻译生成后经本模块保存）

