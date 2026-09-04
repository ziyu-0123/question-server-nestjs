import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService, maskApiKey } from '../user/user.service.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) { }

  async signIn(username: string, password: string) {
    const user = await this.userService.findByUsername(username);
    // 用户不存在或密码不匹配，统一返回「用户名或密码错误」（避免泄露用户是否存在）
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const { password: p, ...userInfo } = user.toObject(); // 排除密码字段

    // return userInfo; // 返回用户信息
    // JWT 载荷只签必要字段：防止 aiConfig（含明文 apiKey）等敏感字段进入 token
    // （JWT payload 仅 base64 编码，可被任何人解码读取）
    const token = this.jwtService.sign({
      username: userInfo.username,
      nickname: userInfo.nickname,
    });
    return { token };
  }

  /**
   * 获取当前登录用户信息（供 GET /api/auth/profile 使用）
   * 入参: username（JWT 载荷中的用户名）
   * 返回: { username, nickname, aiConfigured, aiConfig? }，aiConfig 的 apiKey 打码
   */
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
          apiKey: maskApiKey(aiConfig.apiKey),
          baseUrl: aiConfig.baseUrl,
          model: aiConfig.model,
        },
      }),
    };
  }
}
