import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// 用户自带的 AI 模型配置（嵌套文档需独立 @Schema 类，
// 否则 @nestjs/mongoose 无法从内联对象类型反射推断结构）
@Schema()
export class AiConfig {
  @Prop({ required: true })
  apiKey: string;

  @Prop({ required: true })
  baseUrl: string;

  @Prop({ required: true })
  model: string;
}

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
})
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true })
  password: string;

  @Prop()
  nickname: string;

  @Prop({ type: AiConfig })
  aiConfig?: AiConfig;
}

export const UserSchema = SchemaFactory.createForClass(User);
