# 07 - 答卷模块（Answer）

> 源码目录：[src/answer/](../../src/answer/)
> 职责：回收答卷（问卷答卷 / 访谈记录）、答卷计数与分页查询、单组件统计的数据库聚合。是纯数据写入与读取模块，无业务校验复杂度。

## 1. 模块组成 — [answer.module.ts](../../src/answer/answer.module.ts)

```ts
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Answer.name, schema: AnswerSchema },
      { name: Question.name, schema: QuestionSchema },  // 直接注册 QuestionModel
    ]),
  ],
  exports: [AnswerService],   // 供 StatModule / AiModule 消费
  providers: [AnswerService],
  controllers: [AnswerController],
})
```

> 注意：本模块**不 import QuestionModule**，而是直接在 `forFeature` 中注册 `Question` Model，用于提交答卷时反范式维护 `answerCount`。

## 2. 接口 — [answer.controller.ts](../../src/answer/answer.controller.ts)

| 方法   | 路径            | 鉴权          | 说明            |
| ---- | ------------- | ----------- | ------------- |
| POST | `/api/answer` | `@Public()` | 提交答卷（匿名填写者调用） |

## 3. 关键类与函数 — [answer.service.ts](../../src/answer/answer.service.ts)

### `create(answerInfo: CreateAnswerDto): Promise<AnswerDocument>`

```ts
async create(answerInfo: CreateAnswerDto) {
  if (answerInfo.questionId == null) {
    throw new HttpException('缺少问卷 id', HttpStatus.BAD_REQUEST);
  }
  // 答卷内容至少其一：问卷答卷用 answerList，访谈答卷用 conversationList
  if (answerInfo.answerList == null && answerInfo.conversationList == null) {
    throw new HttpException('缺少答卷内容', HttpStatus.BAD_REQUEST);
  }
  // 只取答卷业务字段入库，防止 body 夹带任意脏字段
  const { questionId, answerList, conversationList, usage } = answerInfo;
  const answer = new this.answerModel({ questionId, answerList, conversationList, usage });
  const saved = await answer.save();
  // 反范式维护答卷计数：列表页直接读 answerCount，避免每页聚合统计
  await this.questionModel.updateOne({ _id: questionId }, { $inc: { answerCount: 1 } });
  return saved;
}
```

要点：

* **双形态答卷**：问卷答卷 `answerList`（组件 id → value 数组）；访谈答卷 `conversationList`（多轮对话记录）+ `usage`（token 用量）。

* **字段过滤**：仅取 4 个业务字段，防脏字段注入。

* **反范式计数**：提交成功后 `$inc` 问卷的 `answerCount`，问卷列表页直接读计数，免去 `countDocuments` 聚合。

### `count(questionId: string): Promise<number>`

答卷总数（questionId 为空返回 0）。

### `findAll(questionId: string, opt: { page, pageSize }): Promise<AnswerDocument[]>`

按 `createdAt` 倒序的分页查询。AI 模块取「全量答卷」时以 `pageSize = answerTotal` 调用。

### `aggregateComponentStat(questionId, componentFeId): Promise<{ value: string; count: number }[]>`

单组件统计的聚合管道（统计下沉到数据库层，避免全量拉取到内存）：

```ts
return await this.answerModel.aggregate<{ value: string; count: number }>([
  { $match: { questionId } },                                    // 锁定问卷
  { $unwind: '$answerList' },                                    // 展开答卷项
  { $match: { 'answerList.componentId': componentFeId } },       // 锁定组件
  // 仅统计非空字符串 value 的答案项（与旧逻辑 value ? split(',') : [] 对齐）
  { $match: { 'answerList.value': { $type: 'string', $ne: '' } } },
  // 多选值以逗号拼接，拆成数组后逐个计数
  { $project: { values: { $split: ['$answerList.value', ','] } } },
  { $unwind: '$values' },                                        // 拆开多选值
  { $group: { _id: '$values', count: { $sum: 1 } } },            // 按 value 计数
  { $project: { _id: 0, value: '$_id', count: 1 } },
]);
```

返回形如 `[{ value: 'item1', count: 3 }, ...]`，value 为选项 value（`itemN`），由 StatService 映射为选项文案。

## 4. DTO — [answer.dto.ts](../../src/answer/dto/answer.dto.ts)

```ts
export interface AnswerItem {
  componentId: string;   // 组件 fe_id
  value: string;         // 单选 'item1'；多选 'item1,item3'（逗号拼接）；填空为原文
}

export interface ConversationItem {
  role: 'interviewer' | 'interviewee';
  content: string;
}

export interface AnswerUsageDto {
  prompt: number;        // 本轮 prompt tokens
  completion: number;    // 本轮 completion tokens
  total: number;
}

export class CreateAnswerDto {
  readonly questionId: string;
  readonly answerList?: AnswerItem[];          // 问卷答卷
  readonly conversationList?: ConversationItem[]; // 访谈对话记录
  readonly usage?: AnswerUsageDto;             // 访谈 token 用量（前端 SSE 累积）
}
```

## 5. 数据模型

`Answer` / `AnswerUsage` Schema 及索引详见 [10 - 数据模型](./10-data-models.md)。

## 6. 依赖关系

```text
AnswerController ──► AnswerService ──► AnswerModel、QuestionModel（Mongoose）
StatService（StatModule）───────────► AnswerService.count / findAll / aggregateComponentStat
AiService（AiModule）───────────────► AnswerService.count / findAll
```

## 7. 相关文档

* [08 - 统计模块](./08-stat-module.md)（聚合结果的消费方）

* [10 - 数据模型](./10-data-models.md)

