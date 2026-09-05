# 08 - 统计模块（Stat）

> 源码目录：[src/stat/](../../src/stat/)
> 职责：面向统计页的数据查询——答卷明细列表（value → text 映射）、单组件选项计数、访谈答卷列表。纯读模块，无写操作。

## 1. 模块组成 — [stat.module.ts](../../src/stat/stat.module.ts)

```ts
@Module({
  imports: [QuestionModule, AnswerModule],  // 复用两个 Service
  exports: [StatService],
  providers: [StatService],
  controllers: [StatController],
})
```

## 2. 接口 — [stat.controller.ts](../../src/stat/stat.controller.ts)

所有路由均带全局前缀 `/api/stat`，均需登录。

| 方法  | 路径                                     | 说明                       |
| --- | -------------------------------------- | ------------------------ |
| GET | `/api/stat/:questionId`                | 问卷答卷明细列表（分页）             |
| GET | `/api/stat/:questionId/interview`      | 访谈答卷列表（分页，含对话与 token 用量） |
| GET | `/api/stat/:questionId/:componentFeId` | 单组件（单选/多选）选项计数           |

> 路由声明顺序注意：`interview` 路由必须声明在 `:componentFeId` 之前，否则 `interview` 会被当作组件 id 匹配。

Query 参数：`page`（默认 1）、`pageSize`（默认 10）。

## 3. 关键类与函数 — [stat.service.ts](../../src/stat/stat.service.ts)

### 类型定义（模块内）

```ts
type OptionItem = { value: string; text: string };
type ComponentProps = { options?: OptionItem[]; list?: (OptionItem & { checked?: boolean })[] };
type ComponentInfo = { fe_id: string; type: string; title: string; props: ComponentProps };
type QuestionLike = { componentList?: ComponentInfo[] };
type AnswerItem = { componentId: string; value: string };
```

### `getQuestionStatListAndCount(questionId, opt): Promise<{ list, total }>`

答卷明细列表（每行一份答卷，列 = 各组件答案文案）：

```ts
const q = await this.questionService.findOne(questionId);
if (q == null) return noData;                  // { list: [], total: 0 }
const total = await this.answerService.count(questionId);
if (total === 0) return noData;
const answers = await this.answerService.findAll(questionId, opt);
const list = answers.map((a) => ({
  _id: a._id,
  ...this._genAnswersInfo(q, a.answerList),    // { [componentId]: 答案文案 }
}));
return { list, total };
```

### `getComponentStat(questionId, componentFeId): Promise<{ name, count }[]>`

单组件统计（仅单选/多选，其他类型返回 `[]`）：

```ts
const comp = componentList.filter((c) => c.fe_id === componentFeId)[0];
if (comp == null) return [];
if (type !== 'questionRadio' && type !== 'questionCheckbox') return [];

// 统计下沉到数据库层：聚合管道按 value 计数，应用层只做 value → text 映射
const counts = await this.answerService.aggregateComponentStat(questionId, componentFeId);

const list = counts.map(({ value, count }) => {
  const text = type === 'questionRadio'
    ? this._getRadioOptText(value, props)
    : this._getCheckboxOptText(value, props);
  return { name: text, count };   // name = 选项文案
});
```

返回示例（供前端饼图/柱状图直接消费）：`[{ name: '非常满意', count: 12 }, { name: '满意', count: 30 }]`

### `getInterviewAnswerList(questionId, opt): Promise<{ list, total }>`

访谈答卷列表（统计端访谈视图）：

```ts
const list = answers.map((a) => ({
  _id: a._id,
  conversationList: a.conversationList ?? [],  // 完整聊天记录
  usage: a.usage,                              // token 用量
}));
```

### 私有辅助函数

| 函数                                      | 作用                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `_getRadioOptText(value, props)`        | 单选 value → 选项文案（遍历 `props.options`）                                            |
| `_getCheckboxOptText(value, props)`     | 多选 value → 选项文案（遍历 `props.list`）                                               |
| `_genAnswersInfo(question, answerList)` | 一份答卷的 answerList 转为 `{ [componentId]: 文案 }`；单选直接映射、多选拆逗号逐项映射后拼接、其他组件原样返回 value |

```ts
private _genAnswersInfo(question, answerList = []) {
  const res: Record<string, string> = {};
  answerList.forEach((a) => {
    const comp = componentList.find((c) => c.fe_id === a.componentId);
    if (!comp) return;
    if (comp.type === 'questionRadio') {
      res[componentId] = this._getRadioOptText(value, comp.props);
    } else if (comp.type === 'questionCheckbox') {
      // 多选值在 C 端以逗号拼接，这里拆开逐项取文案
      const vals = value ? value.split(',') : [];
      res[componentId] = vals.map((v) => this._getCheckboxOptText(v, comp.props))
        .filter(Boolean).toString();
    } else {
      res[componentId] = value;   // 填空题原样
    }
  });
  return res;
}
```

> 注意：value → text 映射依赖**组件 props 中选项的 value（itemN）与答卷 value 一致**，这是「value = itemN 铁律」的下游保证。

## 4. 依赖关系

```text
StatController ──► StatService ──► QuestionService（findOne）
                                ──► AnswerService（count / findAll / aggregateComponentStat）
```

## 5. 相关文档

* [07 - 答卷模块](./07-answer-module.md)（聚合管道所在）

* [09 - AI 模块](./09-ai-module.md)（analyzeReport 在内存中做同类统计）

