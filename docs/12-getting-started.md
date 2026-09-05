# 12 - 运行与部署

## 1. 环境要求

| 依赖 | 版本要求 |
| --- | --- |
| Node.js | 22（Dockerfile / CI 均锁定 node:22 / node-version: 22） |
| npm | 随 Node 22 附带 |
| MongoDB | 7（docker-compose 使用 mongo:7；本地或 Atlas 均可） |

## 2. 环境变量 — [.env.example](../../.env.example)

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 必填 | 默认 / 示例 | 说明 |
| --- | --- | --- | --- |
| `MONGO_URI` | 二选一 | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/nestdb` | 云库连接串（**优先**） |
| `MONGO_HOST` | 二选一 | `127.0.0.1` | 本地库地址（无 MONGO_URI 时与下两项拼装） |
| `MONGO_PORT` | 二选一 | `27017` | 本地库端口 |
| `MONGO_DATABASE` | 二选一 | `nestdb` | 数据库名 |
| `JWT_SECRET` | 生产必填 | `xxYx&&111`（仅开发兜底） | JWT 签名密钥；`NODE_ENV=production` 且未配置时**启动直接失败** |
| `CORS_ORIGINS` | 否 | `http://localhost:3000,http://localhost:5173` | 跨域白名单（逗号分隔） |
| `PORT` | 否 | `3005` | 监听端口 |

> MongoDB 连接优先级见 [app.module.ts](../../src/app.module.ts)：有 `MONGO_URI` 用云库，否则回退 `mongodb://HOST:PORT/DATABASE`。

## 3. 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env     # Windows: copy .env.example .env

# 3. 启动（watch 热重载）
npm run start:dev

# 4. 访问
#   接口:    http://localhost:3005/api
#   Swagger: http://localhost:3005/api/docs
```

本地 MongoDB（可选，docker 方式最简单）：

```bash
docker run -d --name mongo -p 27017:27017 -v mongo-data:/data/db mongo:7
```

首次使用流程：注册（`POST /api/user/register`）→ 登录拿 token（`POST /api/auth/login`）→ 配置 AI 模型（`PATCH /api/user/ai-config`，BYOK）→ 创建问卷 → 使用 AI 能力。

## 4. 生产构建与运行

```bash
npm run build        # nest build → dist/
npm run start:prod   # NODE_ENV 建议设为 production，且必须提供 JWT_SECRET
```

## 5. Docker 部署 — [Dockerfile](../../Dockerfile) / [docker-compose.yml](../../docker-compose.yml)

Dockerfile 为多阶段构建：

```dockerfile
FROM node:22-alpine AS build   # 阶段 1：npm ci + nest build
FROM node:22-alpine            # 阶段 2：仅生产依赖 + dist 产物
ENV NODE_ENV=production
EXPOSE 3005
CMD ["node", "dist/main.js"]
```

一键编排（backend + mongodb）：

```bash
docker compose up -d --build
```

compose 内注入的环境变量：`MONGO_HOST=mongodb`、`MONGO_PORT=27017`、`MONGO_DATABASE=nestdb`、`JWT_SECRET=change-me`（**部署前请替换**）、`CORS_ORIGINS`。数据卷 `mongo-data` 持久化数据库。

## 6. 测试

| 命令 | 范围 | 配置 |
| --- | --- | --- |
| `npm run test` | 单元测试 `**/*.spec.ts` | [vitest.config.ts](../../vitest.config.ts) |
| `npm run test:watch` | watch 模式 | 同上 |
| `npm run test:cov` | 覆盖率（v8 provider） | 同上 |
| `npm run test:e2e` | e2e `**/*.e2e-spec.ts` | [vitest.config.e2e.ts](../../vitest.config.e2e.ts) |

测试现状：

- [app.controller.spec.ts](../../src/app.controller.spec.ts)：AppController 冒烟。
- [ai.service.spec.ts](../../src/ai/ai.service.spec.ts)：AiService 白盒单测（mock 依赖，覆盖私有方法 6 组场景，详见 [09 - AI 模块](./09-ai-module.md)）。
- [test/app.e2e-spec.ts](../../test/app.e2e-spec.ts)：e2e 冒烟（GET / → Hello World!）。

## 7. 代码质量工具

| 工具 | 配置 | 命令 |
| --- | --- | --- |
| oxlint | [oxlint.json](../../oxlint.json)（关闭 no-explicit-any，no-floating-promises 设为 warn） | `npm run lint` |
| prettier | [.prettierrc](../../.prettierrc)（singleQuote + trailingComma all） | `npm run format` |
| TypeScript | [tsconfig.json](../../tsconfig.json)：ESM（nodenext）、target ES2023、strict（除 strictPropertyInitialization） | `npm run build` |

## 8. CI/CD — [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

`main/master` push 与所有 PR 触发，三个并行 job（ubuntu-latest + Node 22 + npm cache）：

```text
lint  ── npm ci → npm run lint
test  ── npm ci → npm test
build ── npm ci → npm run build
```

## 9. 项目结构约定（对新代码的贡献指引）

- 新业务模块遵循 `module / controller / service / schemas / dto` 目录结构，通过 `MongooseModule.forFeature` 注册 Model，Service 放入 `exports` 供跨模块复用。
- 路由默认需登录；匿名接口显式加 `@Public()`。
- 写库接口做「字段白名单 / 显式取字段」，防 body 注入。
- 敏感信息（apiKey）回显必须打码（`maskApiKey`）。
- 全局响应已统一包装，Controller 直接返回业务数据即可；**勿在 Controller 手动包装 `{ errno, data }`**。
- ESM 工程：相对导入必须带 `.js` 后缀。

## 10. 常见问题排查

| 现象 | 原因与处理 |
| --- | --- |
| 启动报「生产环境必须配置 JWT_SECRET」 | 生产模式下 .env 未配置 JWT_SECRET，补充后重启 |
| AI 接口 400「请先配置 AI 模型」 | 当前用户未配置 BYOK，到「AI 设置」保存 apiKey/baseUrl/model |
| AI 接口 400「API Key 无效」 | 用户配置的 Key 不正确，重新保存 |
| AI 接口 503 超时 | OpenAI 兼容服务不可达或慢（client 超时 55s），稍后重试 |
| 访谈流 400「未发布」 | 访谈问卷须先 PATCH isPublished=true |
| 访谈流 400「访谈已达轮次上限」 | 受访者回答轮次已达 20 轮 |
| 跨域报错 | 前端域名未加入 CORS_ORIGINS 白名单 |
