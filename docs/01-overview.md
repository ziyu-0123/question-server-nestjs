# 01 - 项目概览

## 1. 项目定位

`question-server-nestjs`（运行时名为 **AskFlow API**）是 AI 问卷 / 访谈平台的 Node.js 后端服务，围绕两类核心业务对象展开：

- **问卷（survey）**：拖拽式可视化编辑的多页表单，由 7 种组件（问卷信息、标题、段落、单行输入、多行输入、单选、多选）组成，发布后匿名填写、回收答卷、统计分析。
- **访谈（interview）**：由 LLM 扮演「AI 访谈员」，依据提纲与受访者进行一对一多轮流式对话（SSE），结束后整卷保存聊天记录并支持 AI 总结。

平台特色能力（全部由 LLM 驱动）：

| 能力 | 说明 |
| --- | --- |
| AI 生成问卷 | 按一句需求描述生成 5~10 题的完整问卷结构 |
| AI 优化组件 | 润色/补全单个问卷组件的文案与选项 |
| AI 整卷翻译 | 将问卷文案翻译为 6 种语言（en/ja/ko/fr/es/ru） |
| AI 答案总结 | 对开放式问题答案做意见聚类 + 情感分析 |
| AI 分析报告 | 综合整卷统计生成总体结论、每题洞察与改进建议 |
| AI 访谈提纲 | 按访谈目标生成 5~8 个递进式引导问题 |
| AI 访谈对话 | 流式（SSE）多轮访谈，支持提纲推进与自动收尾 |
| AI 访谈总结 | 多份访谈记录的主题聚类 + 情感分析 |

**BYOK（Bring Your Own Key）模式**：每位用户在「AI 设置」中保存自己的 OpenAI 兼容 API Key / baseUrl / model，服务端按用户动态创建客户端，不持有平台级密钥。

## 2. 技术栈

| 类别 | 选型 | 版本 | 用途 |
| --- | --- | --- | --- |
| 框架 | NestJS | ^12.0.1 | 后端框架（Controller / Service / Module 分层） |
| 数据库 | MongoDB + Mongoose | ^9.9.4 | 文档型存储（用户 / 问卷 / 答卷三集合） |
| ODM 集成 | @nestjs/mongoose | ^12.0.0 | Schema 装饰器与依赖注入 |
| 认证 | @nestjs/jwt + bcryptjs | ^12.0.1 / ^3.0.3 | JWT 签发校验、密码加盐哈希 |
| 配置 | @nestjs/config | ^12.0.0 | .env 环境变量（全局模块） |
| LLM | openai | ^7.8.0 | OpenAI 兼容 Chat Completions（含流式） |
| 校验 | zod | ^4.5.4 | LLM 输出结构契约校验 |
| 文档 | @nestjs/swagger | ^12.0.1 | Swagger UI（/api/docs） |
| 唯一 ID | nanoid | ^3.3.18 | 组件 fe_id 生成 |
| 测试 | vitest + supertest | ^4.1.2 / ^7.0.0 | 单元测试 + e2e 测试 |
| Lint | oxlint / prettier | ^1.58.0 / ^3.4.2 | 静态检查与格式化 |
| 运行时 | Node.js 22（ESM） | - | `type: module`，nodenext 模块解析 |

> 项目为 **ESM 工程**：`package.json` 声明 `"type": "module"`，所有相对导入均带 `.js` 后缀。

## 3. 目录结构

```text
question-server-nestjs/
├── src/
│   ├── main.ts                       # 启动入口（全局前缀 /api、CORS、Swagger、端口 3005）
│   ├── app.module.ts                 # 根模块（聚合业务模块 + Mongo 连接）
│   ├── app.controller.ts             # 根路由（GET /、GET /test）
│   ├── app.service.ts                # Hello World 服务
│   ├── transform/                    # 全局响应拦截器（统一 { errno, data }）
│   │   └── transform.interceptor.ts
│   ├── http-exception/               # 全局异常过滤器（统一 { errno: -1, message, ... }）
│   │   └── http-exception.filter.ts
│   ├── auth/                         # 认证模块
│   │   ├── auth.module.ts            # JWT 注册 + 全局守卫（APP_GUARD）
│   │   ├── auth.controller.ts        # POST /auth/login、GET /auth/profile
│   │   ├── auth.service.ts           # signIn / getProfile
│   │   ├── auth.guard.ts             # 全局 JWT Bearer 守卫
│   │   └── decorators/public.decorator.ts  # @Public() 免认证装饰器
│   ├── user/                         # 用户模块
│   │   ├── user.module.ts
│   │   ├── user.controller.ts        # register / info 重定向 / ai-config
│   │   ├── user.service.ts           # create / findByUsername / updateAiConfig / maskApiKey
│   │   ├── schemas/user.schema.ts    # User + AiConfig（嵌套）
│   │   └── dto/                      # CreateUserDto、AiConfigDto
│   ├── question/                     # 问卷模块（survey + interview）
│   │   ├── question.module.ts
│   │   ├── question.controller.ts    # CRUD / 复制 / 译文保存
│   │   ├── question.service.ts       # 全部业务逻辑 + 字段白名单 + 语言白名单
│   │   ├── schemas/question.schema.ts# Question + InterviewConfig + 译文接口
│   │   └── dto/question.dto.ts       # 可更新字段 DTO
│   ├── answer/                       # 答卷模块
│   │   ├── answer.module.ts
│   │   ├── answer.controller.ts      # POST /answer（公开）
│   │   ├── answer.service.ts         # create / count / findAll / aggregateComponentStat
│   │   ├── schemas/answer.schema.ts  # Answer + AnswerUsage（嵌套）
│   │   └── dto/answer.dto.ts
│   ├── stat/                         # 统计模块
│   │   ├── stat.module.ts
│   │   ├── stat.controller.ts        # 答卷列表 / 单组件统计 / 访谈答卷列表
│   │   └── stat.service.ts           # value → text 映射等
│   └── ai/                           # AI 模块（纯生成，不落库）
│       ├── ai.module.ts
│       ├── ai.controller.ts          # 8 个 AI 接口（含 SSE 访谈流）
│       ├── ai.service.ts             # LLM 调用 / 重试 / 规范化 / 流式
│       └── schemas/generate-question.schema.ts  # 全部 zod 输出契约
├── test/
│   └── app.e2e-spec.ts               # e2e 测试
├── docs/wiki/                        # 本 Wiki
├── .github/workflows/ci.yml          # CI（lint → test → build）
├── Dockerfile                        # 多阶段构建（node:22-alpine）
├── docker-compose.yml                # backend + mongodb 编排
├── .env.example                      # 环境变量模板
├── nest-cli.json / tsconfig.json / vitest.config*.ts / oxlint.json / .prettierrc
└── package.json
```

## 4. npm scripts

| 命令 | 说明 |
| --- | --- |
| `npm run start:dev` | 开发模式（watch 热重载） |
| `npm run start:debug` | 调试模式 |
| `npm run start:prod` | 生产模式（先 build，再 `node dist/main`） |
| `npm run build` | `nest build` 编译到 `dist/` |
| `npm run lint` | oxlint 检查 `src/`、`test/` |
| `npm run format` | prettier 格式化 |
| `npm run test` | vitest 单元测试（`*.spec.ts`） |
| `npm run test:e2e` | e2e 测试（`*.e2e-spec.ts`，独立配置） |
| `npm run test:cov` | 覆盖率报告 |

## 5. 相关文档

- [02 - 整体架构](./02-architecture.md)
- [12 - 运行与部署](./12-getting-started.md)
