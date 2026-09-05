# 03 - 公共基础设施

本文档说明全局性的横切组件：启动流程、统一响应规范、异常处理、JWT 认证体系。

## 1. 启动流程 — [main.ts](../../src/main.ts)

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // 路由全局前缀
  app.useGlobalInterceptors(new TransformInterceptor()); // 全局响应拦截器
  app.useGlobalFilters(new HttpExceptionFilter()); // 全局异常过滤器
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
  });

  // Swagger 接口文档（访问 /api/docs）
  const config = new DocumentBuilder()
    .setTitle('AskFlow API')
    .setDescription('AI 问卷 / 访谈平台后端接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3005);
}
await bootstrap();
```

关键点：

| 配置 | 值 / 来源 | 说明 |
| --- | --- | --- |
| 全局路由前缀 | `api` | 所有接口路径均为 `/api/<module>/<route>` |
| 监听端口 | `process.env.PORT` ?? `3005` | Dockerfile 亦暴露 3005 |
| CORS 白名单 | `CORS_ORIGINS`（逗号分隔） | 默认 `http://localhost:3000,http://localhost:5173`（B/C 两端本地端口） |
| Swagger | `/api/docs` | 标题 AskFlow API，启用 BearerAuth |

## 2. 统一响应规范

### 2.1 成功响应 — [transform.interceptor.ts](../../src/transform/transform.interceptor.ts)

`TransformInterceptor` 实现 `NestInterceptor`，将 Controller 返回值包装为：

```json
{
  "errno": 0,
  "data": { "...": "Controller 返回值" }
}
```

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  return next.handle().pipe(map((data) => ({ errno: 0, data })));
}
```

### 2.2 错误响应 — [http-exception.filter.ts](../../src/http-exception/http-exception.filter.ts)

`HttpExceptionFilter` 捕获所有 `HttpException`，返回：

```json
{
  "errno": -1,
  "message": "错误描述",
  "timestamp": "2026-09-05T10:00:00.000Z",
  "path": "/api/auth/login"
}
```

HTTP 状态码保持异常原始值（400 / 401 / 403 / 404 / 503 等）。

> 注意：该过滤器只捕获 `HttpException`。非 HTTP 异常（如未捕获的 TypeError）走 NestJS 默认 500 处理，不会被包装。

### 2.3 前端约定

前端统一以 `errno === 0` 判断成功，`errno === -1` 时读取 `message` 展示错误提示。

## 3. JWT 认证体系

### 3.1 全局守卫 — [auth.guard.ts](../../src/auth/auth.guard.ts)

`AuthGuard` 通过 `APP_GUARD` 在 AuthModule 中注册为**全局守卫**，对所有路由生效：

```ts
async canActivate(context: ExecutionContext) {
  // 1. 反射读取 @Public() 元数据，公开路由直接放行
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (isPublic) return true;

  // 2. 提取 Authorization: Bearer <token>
  const request = context.switchToHttp().getRequest();
  const token = this.extractTokenFromHeader(request);
  if (!token) throw new UnauthorizedException('未登录');

  // 3. 校验 token 并挂载载荷
  try {
    const payload = await this.jwtService.verifyAsync(token);
    request['user'] = payload; // Controller 通过 @Req() req.user.username 取用户
  } catch (err) {
    throw new UnauthorizedException('Token 无效');
  }
  return true;
}
```

`request.user` 载荷固定为 `{ username, nickname }`（见 AuthService.signIn）。

### 3.2 公开路由装饰器 — [public.decorator.ts](../../src/auth/decorators/public.decorator.ts)

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

使用 `@Public()` 的路由跳过 JWT 校验，当前公开路由：

| 路由 | 用途 |
| --- | --- |
| `POST /api/auth/login` | 登录 |
| `POST /api/user/register` | 注册 |
| `GET /api/question/:id` | C 端匿名获取已发布问卷 |
| `POST /api/answer` | 匿名提交答卷 |
| `POST /api/ai/interview/stream` | 匿名 AI 访谈对话（SSE） |

### 3.3 JWT 配置 — [auth.module.ts](../../src/auth/auth.module.ts)

```ts
JwtModule.registerAsync({
  global: true,
  useFactory: (configService: ConfigService) => {
    const secret = configService.get<string>('JWT_SECRET');
    // 生产环境强制要求 JWT_SECRET，禁止用默认弱密钥兜底
    if (process.env.NODE_ENV === 'production' && !secret) {
      throw new Error('生产环境必须配置 JWT_SECRET 环境变量');
    }
    return {
      secret: secret || 'xxYx&&111', // 开发环境兜底
      signOptions: { expiresIn: '1d' }, // token 有效期 1 天
    };
  },
  inject: [ConfigService],
}),
```

- 生产环境（`NODE_ENV=production`）未配置 `JWT_SECRET` 时**启动直接失败**。
- `global: true`：JwtService 全局可用。

## 4. 配置管理

- `ConfigModule.forRoot({ isGlobal: true })`（AppModule）：加载根目录 `.env`，全局注入。
- MongoDB 连接策略（AppModule）：

```ts
MongooseModule.forRootAsync({
  useFactory: (configService: ConfigService) => {
    // 优先用 MONGO_URI（云库如 Atlas），否则回退到 HOST/PORT/DATABASE（本地）
    const uri = configService.get<string>('MONGO_URI');
    return {
      uri: uri ?? `mongodb://${MONGO_HOST}:${MONGO_PORT}/${MONGO_DATABASE}`,
    };
  },
  inject: [ConfigService],
}),
```

环境变量清单见 [12 - 运行与部署](./12-getting-started.md)。

## 5. 根模块与根路由 — [app.module.ts](../../src/app.module.ts) / [app.controller.ts](../../src/app.controller.ts)

- `AppModule` 聚合 6 个业务模块 + ConfigModule + MongooseModule。
- `AppController` 提供两个调试路由：`GET /api`（返回 Hello World!）与 `GET /api/test`（返回 Test）。
- `AppService.getHello()`：返回 `'Hello World!'`。

## 6. 相关文档

- [04 - 认证模块](./04-auth-module.md)
- [12 - 运行与部署](./12-getting-started.md)
