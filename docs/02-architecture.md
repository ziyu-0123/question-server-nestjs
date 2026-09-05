# 02 - 整体架构

## 1. 分层架构总览

项目遵循 NestJS 标准分层，每个业务模块内部为「Controller → Service → Mongoose Model」三层：

```text
                          ┌──────────────────────────────────────────┐
                          │                main.ts                   │
                          │  全局前缀 /api · CORS · Swagger · 3005   │
                          └──────────────────┬───────────────────────┘
                                             │
                    ┌────────────────────────┴────────────────────────┐
                    │                AppModule（根模块）               │
                    │  ConfigModule（全局 .env）                       │
                    │  MongooseModule.forRootAsync（Mongo 连接）        │
                    └──┬──────┬──────┬──────┬──────┬──────┬──────────┘
                       │      │      │      │      │      │
        ┌──────────────┴┐ ┌───┴───┐ ┌┴──────┐ ┌────┴┐ ┌───┴───┐ ┌────┴───┐
        │ QuestionModule│ │UserMod│ │AuthMod│ │Answer│ │StatMod│ │ AiMod  │
        └──────┬────────┘ └───┬───┘ └┬──────┘ └──┬───┘ └───┬───┘ └────┬───┘
               │              │      │           │         │          │
        ┌──────┴──────────────────────────────────────────────────────┴──────┐
        │                     MongoDB（users / questions / answers）          │
        └─────────────────────────────────────────────────────────────────────┘
```

**横切关注点（全局注册）：**

| 组件                     | 注册方式                                 | 作用                                                |
| ---------------------- | ------------------------------------ | ------------------------------------------------- |
| `TransformInterceptor` | `app.useGlobalInterceptors`（main.ts） | 成功响应统一包装为 `{ errno: 0, data }`                    |
| `HttpExceptionFilter`  | `app.useGlobalFilters`（main.ts）      | 异常统一包装为 `{ errno: -1, message, timestamp, path }` |
| `AuthGuard`            | `APP_GUARD`（AuthModule providers）    | 全局 JWT 认证守卫，`@Public()` 装饰的路由放行                   |

## 2. 请求生命周期

一次典型请求在管道中的流转顺序：

```text
客户端
  │ ① HTTP 请求（携带 / 不携带 Authorization: Bearer <token>）
  ▼
CORS 中间件（main.ts，白名单校验）
  ▼
AuthGuard（全局守卫）
  │  - 反射读取 @Public() 元数据 → 公开路由直接放行
  │  - 否则提取 Bearer token → verifyAsync 校验 → request.user = payload
  │  - 无 token / token 无效 → 抛 UnauthorizedException
  ▼
Controller（路由层）
  │  - 参数提取（@Body / @Query / @Param / @Req）
  │  - 调用 Service
  ▼
Service（业务层）
  │  - 校验 / 权限判断（如 author === username）
  │  - 调用 Mongoose Model 操作数据库
  │  - 或调用 OpenAI 客户端请求 LLM
  ▼
TransformInterceptor（成功路径）
  │  - 响应体包装为 { errno: 0, data: <返回值> }
  ▼
客户端

异常路径：任意层抛出 HttpException
  → HttpExceptionFilter 捕获
  → { errno: -1, message, timestamp, path }（保持原始 HTTP 状态码）
```

> 例外：`POST /api/ai/interview/stream` 使用 `@Res()` 直接操作 Response 对象输出 SSE 流，**绕开**全局拦截器与过滤器；校验失败仍在 Service 内抛 HttpException，由全局过滤器正常接管。

## 3. 模块依赖关系

```text
AuthModule ──────依赖──────► UserModule（复用 UserService 查询用户）
StatModule ──────依赖──────► QuestionModule、AnswerModule（复用两个 Service）
AiModule   ──────依赖──────► UserModule、QuestionModule、AnswerModule

AnswerModule：自身注册 Answer 与 Question 两个 Model（不 import QuestionModule，
              直接注入 QuestionModel 做 answerCount 反范式 $inc）
QuestionModule / UserModule：独立，仅注册自身 Model
```

各模块通过 `exports` 对外暴露 Service，供其他模块构造函数注入：

| 模块             | exports         | 被谁消费                |
| -------------- | --------------- | ------------------- |
| UserModule     | UserService     | AuthModule、AiModule |
| QuestionModule | QuestionService | StatModule、AiModule |
| AnswerModule   | AnswerService   | StatModule、AiModule |

## 4. 核心业务流程

### 4.1 问卷生命周期

```text
注册/登录 ──► 创建问卷（POST /question，type=survey|interview）
        ──► 编辑（PATCH /question/:id，字段白名单）
             ├─ survey：拖拽组件、AI 生成、AI 优化、AI 翻译
             └─ interview：AI 生成提纲（outline）
        ──► 发布（PATCH isPublished=true）
        ──► 匿名填写（POST /answer，公开接口）
             ├─ survey：answerList = [{ componentId, value }]
             └─ interview：conversationList + usage（SSE 对话后提交）
        ──► 统计（GET /stat/:questionId/*）
        ──► AI 总结（POST /ai/summarize-answers、analyze-report、summarize-interview）
```

### 4.2 AI 生成通用流程（JSON 模式）

```text
requireAiConfig(username) 读取用户 BYOK 配置（未配置 → 400 带引导）
  ▼
拼装 messages（system 提示词契约 + user 内容）
  ▼
chatWithRetry：调用 LLM（response_format: json_object, temperature 0.7）
  ├─ 请求异常 → mapLlmError 映射为中文业务提示（Key 无效/超时/余额等）
  ├─ 输出非 JSON → 重试
  ├─ zod 校验失败 → 把错误信息作为上下文反馈给模型，重试 1 次
  └─ 两次均失败 → 503 ServiceUnavailableException
  ▼
normalize 规范化（补 fe_id、重写选项 value 为 itemN、生成图层标题）
  ▼
返回纯生成结果（不落库，由前端确认后经 PATCH /question/:id 保存）
```

### 4.3 AI 访谈流（SSE 模式）

```text
POST /api/ai/interview/stream（公开，填写者匿名）
  ▼
prepareInterviewStream 校验：问卷存在 / type=interview / 已发布 / 轮次<20 / 作者已配 AI
  ▼
Controller 设置 SSE 响应头 → 启动 15s 心跳（首 token 前保活）
  ▼
chatStream 流式消费 LLM chunk：
  ├─ 增量文本 → data: <text> 逐条推送
  ├─ 检测 [[END]] 结束标记 → 剥离标记，标记 finished
  ├─ finished → event: finished（前端启用结束按钮）
  ├─ usage chunk → event: usage（token 用量）
  └─ 客户端断开 → AbortController 中止上游请求，静默返回
  ▼
data: [DONE] 结束
```

## 5. 架构设计决策

| 决策                   | 说明                                                                  |
| -------------------- | ------------------------------------------------------------------- |
| **AI 纯生成不落库**        | 所有 AI 接口只返回生成结果，持久化由前端通过问卷更新接口完成，保持 AI 层无副作用                        |
| **BYOK**             | 每用户独立 apiKey/baseUrl/model，服务端动态创建 OpenAI client，无平台密钥              |
| **反范式 answerCount**  | 提交答卷时 `$inc` 维护问卷上的计数字段，列表页免聚合查询                                    |
| **value = itemN 铁律** | 单选/多选选项 value 统一为 `item1..itemN`，作为统计聚合的稳定 key，文案变更不影响统计            |
| **更新字段白名单**          | 问卷更新只接受白名单字段，防止客户端注入 `author`/`_id` 篡改归属                            |
| **apiKey 打码**        | 任何回显场景只输出 `sk-***x1y2` 形式，明文仅存库                                     |
| **JWT 最小载荷**         | token 只签 `username`/`nickname`，敏感字段（含明文 apiKey 的 aiConfig）绝不入 token |
| **统计下沉数据库**          | 单组件统计用 Mongo aggregation pipeline 在库内完成计数，应用层只做 value→text 映射       |
| **译文只存差异**           | `translations` 按 fe\_id 存文案差异，未命中回退主版本文案，不复制结构                      |

## 6. 相关文档

* [03 - 公共基础设施](./03-common.md)

* [10 - 数据模型](./10-data-models.md)

