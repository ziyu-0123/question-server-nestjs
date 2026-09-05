# 04 - 认证模块（Auth）

> 源码目录：[src/auth/](../../src/auth/)
> 职责：登录凭证校验、JWT 签发、当前用户信息查询。全局守卫 `AuthGuard` 与 `@Public()` 装饰器也定义在本模块（见 [03 - 公共基础设施](./03-common.md)）。

## 1. 模块组成 — [auth.module.ts](../../src/auth/auth.module.ts)

```ts
@Module({
  imports: [
    UserModule,                          // 复用 UserService 查询用户
    JwtModule.registerAsync({ ... }),    // global: true，secret 来自 JWT_SECRET
  ],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },  // 注册全局 JWT 守卫
  ],
  controllers: [AuthController],
})
export class AuthModule { }
```

## 2. 接口 — [auth.controller.ts](../../src/auth/auth.controller.ts)

| 方法   | 路径                  | 鉴权          | 说明                  |
| ---- | ------------------- | ----------- | ------------------- |
| POST | `/api/auth/login`   | `@Public()` | 登录，返回 JWT           |
| GET  | `/api/auth/profile` | 需登录         | 当前用户信息（aiConfig 打码） |

## 3. 关键类与函数 — [auth.service.ts](../../src/auth/auth.service.ts)

### `AuthService.signIn(username: string, password: string): Promise<{ token: string }>`

登录主流程：

```ts
async signIn(username: string, password: string) {
  const user = await this.userService.findByUsername(username);
  // 用户不存在或密码不匹配，统一返回「用户名或密码错误」（避免泄露用户是否存在）
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new UnauthorizedException('用户名或密码错误');
  }

  const { password: p, ...userInfo } = user.toObject(); // 排除密码字段
  // JWT 载荷只签必要字段：防止 aiConfig（含明文 apiKey）等敏感字段进入 token
  const token = this.jwtService.sign({
    username: userInfo.username,
    nickname: userInfo.nickname,
  });
  return { token };
}
```

设计要点：

* **统一错误文案**：用户不存在与密码错误均返回「用户名或密码错误」，防止枚举探测用户名。

* **bcrypt.compare**：与注册时的 `bcrypt.hash(password, 10)` 对应。

* **最小 JWT 载荷**：仅 `username` + `nickname`。JWT payload 只是 base64 编码，任何人可解码，故含明文 apiKey 的 `aiConfig` 绝不入 token。

* **有效期**：`expiresIn: '1d'`。

### `AuthService.getProfile(username: string): Promise<Profile>`

供 `GET /api/auth/profile` 使用（username 取自 JWT 载荷）：

```ts
async getProfile(username: string) {
  const user = await this.userService.findByUsername(username);
  // token 有效但用户已被删除（如手动清库）时按未授权处理
  if (!user) {
    throw new UnauthorizedException('用户不存在');
  }
  const { aiConfig } = user;
  return {
    username: user.username,
    nickname: user.nickname,
    aiConfigured: Boolean(aiConfig),
    // 未配置时不返回 aiConfig 字段；已配置时 apiKey 打码，避免明文泄露
    ...(aiConfig && {
      aiConfig: {
        apiKey: maskApiKey(aiConfig.apiKey),  // sk-abc***x1y2
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
      },
    }),
  };
}
```

返回结构：

```ts
{
  username: string
  nickname: string
  aiConfigured: boolean        // 是否已配置 AI 模型
  aiConfig?: {                 // 已配置时返回，apiKey 打码
    apiKey: string             // 如 'sk-***x1y2'
    baseUrl: string
    model: string
  }
}
```

> 边界情况：token 有效但用户已被删除 → 401「用户不存在」。

## 4. 依赖关系

```text
AuthController ──► AuthService ──► UserService（UserModule 导出）
                              ──► JwtService（JwtModule，global）
AuthGuard(APP_GUARD) ──► JwtService、Reflector
```

## 5. 相关文档

* [03 - 公共基础设施](./03-common.md)（AuthGuard / @Public / JWT 配置）

* [05 - 用户模块](./05-user-module.md)

