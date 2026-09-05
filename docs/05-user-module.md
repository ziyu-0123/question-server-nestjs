# 05 - 用户模块（User）

> 源码目录：[src/user/](../../src/user/)
> 职责：用户注册（密码哈希）、用户查询、AI 模型配置管理（BYOK 核心）。

## 1. 模块组成 — [user.module.ts](../../src/user/user.module.ts)

```ts
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  exports: [UserService],   // 供 AuthModule / AiModule 消费
  providers: [UserService],
  controllers: [UserController],
})
```

## 2. 接口 — [user.controller.ts](../../src/user/user.controller.ts)

| 方法    | 路径                    | 鉴权          | 说明                                |
| ----- | --------------------- | ----------- | --------------------------------- |
| POST  | `/api/user/register`  | `@Public()` | 注册，返回 `{ username, nickname }`    |
| GET   | `/api/user/info`      | -           | 302 重定向到 `/api/auth/profile`      |
| POST  | `/api/user/login`     | `@Public()` | 307 重定向到 `/api/auth/login`（兼容旧入口） |
| PATCH | `/api/user/ai-config` | 需登录         | 更新当前用户 AI 模型配置                    |

### 2.1 注册 — `register`

```ts
@Public()
@Post('register')
async register(@Body() userDto: CreateUserDto) {
  try {
    const user = await this.userService.create(userDto);
    // 不回显完整用户文档（含明文 password），只返回非敏感字段
    return { username: user.username, nickname: user.nickname };
  } catch (err) {
    throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
  }
}
```

> 用户名重复时 Mongoose unique 索引抛错，被转成 400 返回。

### 2.2 更新 AI 配置 — `updateAiConfig`

入参 Body（AiConfigDto）：`{ apiKey, baseUrl, model }`，需 Bearer token。

## 3. 关键类与函数 — [user.service.ts](../../src/user/user.service.ts)

### `maskApiKey(apiKey: string): string`（模块级导出函数）

apiKey 打码工具，供本模块与 AuthService 共用：

```ts
// apiKey 打码：保留前 3 后 4 位，如 sk-abc***x1y2，供前端回显
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 3)}***${apiKey.slice(-4)}`;
}
```

### `UserService.create(userData: CreateUserDto): Promise<UserDocument>`

```ts
async create(userData: CreateUserDto) {
  // 只取注册业务字段入库，防止 body 夹带 aiConfig 等任意字段
  const { username, password, nickname } = userData;
  // 密码加盐哈希后入库，不存明文
  const hashedPassword = await bcrypt.hash(password, 10);
  const createdUser = new this.userModel({ username, password: hashedPassword, nickname });
  return await createdUser.save();
}
```

* **字段过滤**：仅取 `username / password / nickname` 三字段，防 body 注入。

* **bcrypt 加盐**：cost factor = 10。

### `UserService.findByUsername(username: string): Promise<UserDocument | null>`

按用户名查单个用户（登录、profile、AI 配置读取等多处复用）。

### `UserService.updateAiConfig(username: string, aiConfig: AiConfigDto)`

BYOK 配置更新主流程：

```ts
async updateAiConfig(username: string, aiConfig: AiConfigDto) {
  const { apiKey = '', baseUrl = '', model = '' } = aiConfig ?? {};
  if (!baseUrl || !model) {
    throw new BadRequestException('baseUrl、model 均不能为空');
  }
  if (!/^https:\/\//.test(baseUrl)) {
    throw new BadRequestException('baseUrl 必须以 https:// 开头');  // 防 SSRF / 中间人
  }

  const user = await this.userModel.findOne({ username });
  if (!user) {
    throw new NotFoundException('用户不存在');
  }

  // apiKey 留空表示沿用原值（前端只回显打码值，不回传明文）；从未配置则必须填写
  const finalApiKey = apiKey || user.aiConfig?.apiKey;
  if (!finalApiKey) {
    throw new BadRequestException('请填写 API Key');
  }

  user.aiConfig = { apiKey: finalApiKey, baseUrl, model };
  await user.save();

  // 只回显打码后的配置，避免明文 apiKey 出现在响应中
  return { apiKey: maskApiKey(finalApiKey), baseUrl, model };
}
```

校验规则：

| 规则                          | 错误                            |
| --------------------------- | ----------------------------- |
| `baseUrl`、`model` 必填        | 400「baseUrl、model 均不能为空」      |
| `baseUrl` 必须以 `https://` 开头 | 400「baseUrl 必须以 https\:// 开头」 |
| `apiKey` 留空且历史上从未配置         | 400「请填写 API Key」              |
| 用户不存在                       | 404「用户不存在」                    |

**「留空沿用原值」语义**：前端回显的是打码值（`sk-***x1y2`），编辑时不回传明文；用户只改 baseUrl/model 而不动 Key 时，提交空 apiKey 即保留原 Key。

## 4. DTO

### [create-user.dto.ts](../../src/user/dto/create-user.dto.ts)

```ts
export class CreateUserDto {
  readonly username: string;
  readonly password: string;
  readonly nickname: string;
}
```

### [ai-config.dto.ts](../../src/user/dto/ai-config.dto.ts)

```ts
export class AiConfigDto {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}
```

> DTO 为纯类型声明（无 class-validator 装饰器），实际校验逻辑在 Service 内。

## 5. 数据模型

`User` / `AiConfig` Schema 详见 [10 - 数据模型](./10-data-models.md)。

## 6. 依赖关系

```text
UserController ──► UserService ──► UserModel（Mongoose）
AuthService（AuthModule）────────► UserService.findByUsername
AiService（AiModule）───────────► UserService.findByUsername（读取 aiConfig）
AuthService ────────────────────► maskApiKey（导入自 user.service.ts）
```

## 7. 相关文档

* [04 - 认证模块](./04-auth-module.md)

* [09 - AI 模块](./09-ai-module.md)（BYOK 使用方）

