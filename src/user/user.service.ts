import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { AiConfigDto } from './dto/ai-config.dto.js';

// apiKey 打码：保留前 3 后 4 位，如 sk-abc***x1y2，供前端回显
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '***';
  return `${apiKey.slice(0, 3)}***${apiKey.slice(-4)}`;
}

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) { }

  async create(userData: CreateUserDto) {
    // 只取注册业务字段入库，防止 body 夹带 aiConfig 等任意字段
    const { username, password, nickname } = userData;
    const createdUser = new this.userModel({ username, password, nickname });
    return await createdUser.save();
  }

  async findOne(query: { username: string; password: string }) {
    return await this.userModel.findOne(query);
  }

  async findByUsername(username: string) {
    return await this.userModel.findOne({ username });
  }

  /**
   * 更新当前用户的 AI 模型配置
   * 入参: username（登录态用户）、aiConfig（apiKey / baseUrl / model）
   * 返回: 更新后的 aiConfig（apiKey 已打码）
   */
  async updateAiConfig(username: string, aiConfig: AiConfigDto) {
    const { apiKey = '', baseUrl = '', model = '' } = aiConfig ?? {};
    if (!baseUrl || !model) {
      throw new BadRequestException('baseUrl、model 均不能为空');
    }
    if (!/^https:\/\//.test(baseUrl)) {
      throw new BadRequestException('baseUrl 必须以 https:// 开头');
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
    return {
      apiKey: maskApiKey(finalApiKey),
      baseUrl,
      model,
    };
  }
}

