# AskFlow 后端 Code Wiki

> 项目：`question-server-nestjs` —— AI 问卷 / 访谈平台后端服务（AskFlow API）
> 技术栈：NestJS 12 + MongoDB (Mongoose 9) + JWT + OpenAI 兼容 API (BYOK) + Zod

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [01 - 项目概览](./01-overview.md) | 项目定位、技术栈、目录结构、依赖清单 |
| [02 - 整体架构](./02-architecture.md) | 分层架构、请求生命周期、模块依赖关系图 |
| [03 - 公共基础设施](./03-common.md) | 启动流程、全局拦截器/过滤器、JWT 认证守卫、统一响应规范 |
| [04 - 认证模块](./04-auth-module.md) | 登录签发 JWT、获取用户信息 |
| [05 - 用户模块](./05-user-module.md) | 注册、AI 模型配置（BYOK）、apiKey 打码策略 |
| [06 - 问卷模块](./06-question-module.md) | 问卷/访谈 CRUD、复制、多语言译文、字段白名单 |
| [07 - 答卷模块](./07-answer-module.md) | 答卷提交、答卷计数反范式维护、聚合统计管道 |
| [08 - 统计模块](./08-stat-module.md) | 答卷列表、单组件统计、访谈答卷视图 |
| [09 - AI 模块](./09-ai-module.md) | 生成问卷、优化组件、翻译、答案总结、报告、AI 访谈（SSE） |
| [10 - 数据模型](./10-data-models.md) | MongoDB 集合结构、组件契约、索引设计 |
| [11 - API 接口参考](./11-api-reference.md) | 全部 HTTP 接口一览（方法、路径、鉴权、入参、出参） |
| [12 - 运行与部署](./12-getting-started.md) | 环境变量、本地开发、Docker 部署、测试、CI/CD |

## 快速开始

```bash
npm install
cp .env.example .env    # 按需修改 MongoDB / JWT 配置
npm run start:dev       # http://localhost:3005/api
```

- Swagger 接口文档：<http://localhost:3005/api/docs>
- Docker 一键部署：`docker compose up -d`（含 MongoDB）

## 项目一句话简介

为「AI 问卷 / 访谈平台」提供后端能力：用户注册登录后可创建**拖拽式问卷**（survey）或 **AI 访谈**（interview），问卷支持 AI 生成、润色、多语言翻译，回收的答卷支持统计分析与 AI 总结报告；AI 访谈由 LLM 扮演访谈员与匿名受访者流式对话（SSE）。所有 AI 能力基于用户自带的 API Key（BYOK 模式），服务端不持有任何平台级密钥。
