import { Controller, Post, Body, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { CreateUserDto } from '../user/dto/create-user.dto.js';
// import { AuthGuard } from './auth.guard.js';
import { Public } from './decorators/public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() userInfo: CreateUserDto) {
    const { username, password } = userInfo;
    return await this.authService.signIn(username, password);
  }

  // @UseGuards(AuthGuard)
  @Get('profile')
  async getProfile(@Req() req: Request & { user: { username: string } }) {
    return await this.authService.getProfile(req.user.username);
  }
}
