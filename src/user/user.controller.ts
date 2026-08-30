import {
  Controller,
  Body,
  Get,
  Redirect,
  Post,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post('register')
  async register(@Body() userDto: CreateUserDto) {
    try {
      return await this.userService.create(userDto);
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
}
