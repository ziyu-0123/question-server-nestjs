import {
  Controller,
  Body,
  Get,
  Redirect,
  Post,
  Patch,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { type Request } from 'express';
import { UserService } from './user.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { AiConfigDto } from './dto/ai-config.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Public()
  @Post('register')
  async register(@Body() userDto: CreateUserDto) {
    try {
      const user = await this.userService.create(userDto);
      // 不回显完整用户文档（含明文 password），只返回非敏感字段
      return { username: user.username, nickname: user.nickname };
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : String(err),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('info')
  @Redirect('/api/auth/profile', 302) //http状态码302表示临时定向，301表示永久定向(get方法)
  async info() {
    return;
  }

  @Public()
  @Post('login')
  @Redirect('/api/auth/login', 307) //http状态码307表示临时定向，308表示永久定向(post方法)
  async login() {
    return;
  }

  /**
   * 更新当前登录用户的 AI 模型配置
   * 入参: Body { apiKey, baseUrl, model }，需登录（Bearer token）
   * 返回: 更新后的配置（apiKey 打码），如 { apiKey: 'sk-***x1y2', baseUrl, model }
   */
  @Patch('ai-config')
  async updateAiConfig(
    @Req() req: Request & { user: { username: string } },
    @Body() aiConfigDto: AiConfigDto,
  ) {
    return await this.userService.updateAiConfig(req.user.username, aiConfigDto);
  }
}
