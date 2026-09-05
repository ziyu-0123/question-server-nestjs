# 11 - API 接口参考

> 所有响应经 `TransformInterceptor` 包装为 `{ errno: 0, data }`；错误经 `HttpExceptionFilter` 包装为 `{ errno: -1, message, timestamp, path }`。
> 需登录的接口携带请求头 `Authorization: Bearer <token>`（token 由 `POST /api/auth/login` 获取，有效期 1 天）。
> 交互式文档：运行时访问 <http://localhost:3005/api/docs>（Swagger）。

## 接口总览

| #  | 方法     | 路径                                     | 鉴权     | 模块                            |
| -- | ------ | -------------------------------------- | ------ | ----------------------------- |
| 1  | GET    | `/api`                                 | -      | app                           |
| 2  | POST   | `/api/auth/login`                      | 公开     | auth                          |
| 3  | GET    | `/api/auth/profile`                    | 登录     | auth                          |
| 4  | POST   | `/api/user/register`                   | 公开     | user                          |
| 5  | GET    | `/api/user/info`                       | -      | user（302 → /api/auth/profile） |
| 6  | POST   | `/api/user/login`                      | 公开     | user（307 → /api/auth/login）   |
| 7  | PATCH  | `/api/user/ai-config`                  | 登录     | user                          |
| 8  | POST   | `/api/question`                        | 登录     | question                      |
| 9  | GET    | `/api/question`                        | 登录     | question                      |
| 10 | GET    | `/api/question/:id`                    | 公开     | question                      |
| 11 | PATCH  | `/api/question/:id`                    | 登录（作者） | question                      |
| 12 | PUT    | `/api/question/:id/translations`       | 登录（作者） | question                      |
| 13 | DELETE | `/api/question/:id`                    | 登录（作者） | question                      |
| 14 | DELETE | `/api/question`                        | 登录（作者） | question                      |
| 15 | POST   | `/api/question/duplicate/:id`          | 登录     | question                      |
| 16 | POST   | `/api/answer`                          | 公开     | answer                        |
| 17 | GET    | `/api/stat/:questionId`                | 登录     | stat                          |
| 18 | GET    | `/api/stat/:questionId/interview`      | 登录     | stat                          |
| 19 | GET    | `/api/stat/:questionId/:componentFeId` | 登录     | stat                          |
| 20 | POST   | `/api/ai/generate-question`            | 登录     | ai                            |
| 21 | POST   | `/api/ai/optimize-component`           | 登录     | ai                            |
| 22 | POST   | `/api/ai/translate-question`           | 登录     | ai                            |
| 23 | POST   | `/api/ai/summarize-answers`            | 登录（作者） | ai                            |
| 24 | POST   | `/api/ai/analyze-report`               | 登录（作者） | ai                            |
| 25 | POST   | `/api/ai/generate-interview-outline`   | 登录     | ai                            |
| 26 | POST   | `/api/ai/interview/stream`             | 公开     | ai（SSE）                       |
| 27 | POST   | `/api/ai/summarize-interview`          | 登录（作者） | ai                            |

## 1. 认证

### POST /api/auth/login

```json
// Request
{ "username": "admin", "password": "123456" }

// Response 200
{ "errno": 0, "data": { "token": "<jwt>" } }

// Response 401
{ "errno": -1, "message": "用户名或密码错误", "timestamp": "...", "path": "/api/auth/login" }
```

### GET /api/auth/profile

```json
// Response 200
{
  "errno": 0,
  "data": {
    "username": "admin",
    "nickname": "管理员",
    "aiConfigured": true,
    "aiConfig": { "apiKey": "sk-***x1y2", "baseUrl": "https://api.xxx.com/v1", "model": "gpt-4o" }
  }
}
```

## 2. 用户

### POST /api/user/register

```json
// Request
{ "username": "admin", "password": "123456", "nickname": "管理员" }

// Response 200
{ "errno": 0, "data": { "username": "admin", "nickname": "管理员" } }
```

### PATCH /api/user/ai-config

```json
// Request（apiKey 留空 = 沿用原值）
{ "apiKey": "", "baseUrl": "https://api.xxx.com/v1", "model": "gpt-4o" }

// Response 200
{ "errno": 0, "data": { "apiKey": "sk-***x1y2", "baseUrl": "https://api.xxx.com/v1", "model": "gpt-4o" } }
```

## 3. 问卷

### POST /api/question

```json
// Request（type 可省略，默认 survey）
{ "type": "interview" }

// Response 200：新建问卷完整文档（含 _id、componentList、answerCount 等）
{ "errno": 0, "data": { "_id": "66e...", "title": "访谈标题1725...", "type": "interview", "componentList": [], "interviewConfig": { "outline": [] } } }
```

### GET /api/question?keyword=\&page=1\&pageSize=10\&isDeleted=false\&isStar=null

```json
// Response 200
{
  "errno": 0,
  "data": {
    "list": [ { "_id": "...", "title": "...", "answerCount": 12 } ],
    "count": 42
  }
}
```

### GET /api/question/:id（公开）

返回问卷完整文档（C 端渲染表单 / 访谈对话使用）。

### PATCH /api/question/:id

Body 为 `QuestionDto` 可选字段（title / desc / js / css / isPublished / isStar / isDeleted / componentList / type / interviewConfig），仅白名单字段生效。非作者静默 no-op。

### PUT /api/question/:id/translations

```json
// Request（lang ∈ en/ja/ko/fr/es/ru）
{
  "lang": "en",
  "translation": {
    "title": "Canteen Satisfaction Survey",
    "desc": "Please take 1 minute",
    "texts": { "<fe_id>": { "title": "How satisfied are you?" } }
  }
}

// Response 200
{ "errno": 0, "data": null }
// 403 无权操作该问卷 / 400 不支持的目标语言 / 400 译文数据不合法
```

### DELETE /api/question/:id 与 DELETE /api/question

单删：path 参数 id；批量：`{ "ids": ["id1", "id2"] }`。均限作者，返回 Mongoose 删除结果。

### POST /api/question/duplicate/:id

复制问卷（重新生成所有 fe\_id、不继承译文、副本未发布、answerCount 归零），副本归属当前操作者。

## 4. 答卷

### POST /api/answer（公开）

```json
// 问卷答卷
{
  "questionId": "66e...",
  "answerList": [
    { "componentId": "<fe_id>", "value": "item1" },
    { "componentId": "<fe_id>", "value": "item1,item3" },
    { "componentId": "<fe_id>", "value": "自由文本" }
  ]
}

// 访谈答卷
{
  "questionId": "66e...",
  "conversationList": [
    { "role": "interviewer", "content": "您好，先做个自我介绍？" },
    { "role": "interviewee", "content": "我是一名大学生……" }
  ],
  "usage": { "prompt": 1200, "completion": 800, "total": 2000 }
}

// Response 200：完整答卷文档；400 缺少问卷 id / 缺少答卷内容
```

## 5. 统计

### GET /api/stat/:questionId?page=1\&pageSize=10

```json
// Response 200（list 每项为 { _id, [fe_id]: 答案文案 }）
{
  "errno": 0,
  "data": {
    "list": [ { "_id": "...", "w2xK9...": "非常满意", "h3jK8...": "米饭,面条" } ],
    "total": 42
  }
}
```

### GET /api/stat/:questionId/interview?page=1\&pageSize=10

返回 `{ list: [{ _id, conversationList, usage }], total }`。

### GET /api/stat/:questionId/:componentFeId

```json
// Response 200（仅单选/多选组件；name 为选项文案）
{ "errno": 0, "data": { "stat": [ { "name": "非常满意", "count": 12 }, { "name": "满意", "count": 30 } ] } }
```

## 6. AI

### POST /api/ai/generate-question

```json
// Request
{ "prompt": "生成一份食堂满意度调查问卷" }

// Response 200（纯生成不落库；componentList 已含 fe_id 与规范化 props）
{
  "errno": 0,
  "data": {
    "title": "食堂满意度调查",
    "desc": "为了改善食堂服务质量，请花 1 分钟填写",
    "componentList": [
      { "fe_id": "abc123", "type": "questionInfo", "title": "问卷信息", "isHidden": false, "isLocked": false,
        "props": { "title": "食堂满意度调查", "desc": "为了改善食堂服务质量，请花 1 分钟填写" } },
      { "fe_id": "def456", "type": "questionRadio", "title": "您对食堂饭菜的总体满意度是？", "isHidden": false, "isLocked": false,
        "props": { "title": "您对食堂饭菜的总体满意度是？", "isVertical": false,
          "options": [ { "value": "item1", "text": "非常满意" }, { "value": "item2", "text": "满意" } ] } }
    ]
  }
}
```

### POST /api/ai/optimize-component

```json
// Request
{ "component": { "type": "questionRadio", "props": { "title": "你满意吗", "isVertical": false, "options": [{ "text": "满意" }] } },
  "instruction": "选项更完整一些" }

// Response 200
{ "errno": 0, "data": { "props": { "title": "您对食堂饭菜的总体满意度是？", "isVertical": false,
  "options": [ { "value": "item1", "text": "非常满意" }, { "value": "item2", "text": "满意" }, { "value": "item3", "text": "不满意" } ] } } }
```

### POST /api/ai/translate-question

```json
// Request
{ "targetLang": "English", "question": { "title": "...", "desc": "...", "componentList": [] } }

// Response 200：与入参同构的译文（仅文案字段为译文）
```

### POST /api/ai/summarize-answers

```json
// Request
{ "questionId": "66e...", "componentId": "<fe_id>" }

// Response 200
{
  "errno": 0,
  "data": {
    "summary": "受访者整体满意，主要诉求是增加菜品种类……",
    "totalCount": 58,
    "themes": [
      { "label": "菜品丰富度", "count": 21, "description": "希望增加菜品种类。典型原话：\"希望能多一些菜\"" },
      { "label": "无有效观点", "count": 5, "description": "灌水或无实际内容" }
    ],
    "sentiment": { "positive": 40, "negative": 8, "neutral": 10 }
  }
}
```

### POST /api/ai/analyze-report

```json
// Request
{ "questionId": "66e..." }

// Response 200
{
  "errno": 0,
  "data": {
    "overview": "共回收 42 份答卷，总体满意度偏高，最突出的问题是高峰期排队时间长……",
    "insights": [
      { "question": "您对食堂饭菜的总体满意度是？", "finding": "71% 表示满意或非常满意", "chartDesc": "建议用饼图展示三项占比" }
    ],
    "suggestions": ["高峰期增设临时窗口，分流排队人群", "每月轮换地方风味档口，丰富菜品"]
  }
}
```

### POST /api/ai/generate-interview-outline

```json
// Request
{ "title": "大学生睡眠习惯访谈", "desc": "了解本科生作息与影响因素" }

// Response 200
{ "errno": 0, "data": { "outline": ["请先介绍一下你最近的作息安排。", "你通常几点入睡？为什么？"] } }
```

### POST /api/ai/interview/stream（SSE，公开）

```json
// Request
{ "questionId": "66e...", "history": [ { "role": "interviewee", "content": "我是一名大三学生" } ] }
```

响应为 `text/event-stream`（非 JSON 包装），事件序列：

```text
data: "你好！很高兴认识你。先做个简单的自我介绍..."
data: "接下来想聊聊你的日常安排。你通常几点起床？"
event: finished
data: {}
event: usage
data: {"prompt":900,"completion":150,"total":1050}
data: [DONE]
```

错误码：400 参数不合法 / 不是访谈问卷 / 未发布 / 超轮次 / 创建者未配置；404 问卷不存在。

### POST /api/ai/summarize-interview

```json
// Request
{ "questionId": "66e..." }

// Response 200：结构同 summarize-answers（summary / totalCount / themes / sentiment）
```

## 7. 通用错误码

| HTTP 状态                         | 场景                               |
| ------------------------------- | -------------------------------- |
| 400 BadRequestException         | 参数不合法、未配置 AI、apiKey/baseUrl 校验失败 |
| 401 UnauthorizedException       | 未登录 / Token 无效 / 登录失败 / 用户不存在    |
| 403 ForbiddenException          | 非作者操作（保存译文）                      |
| 404 NotFoundException           | 问卷 / 用户不存在                       |
| 503 ServiceUnavailableException | AI 请求超时 / 格式重试仍失败                |

