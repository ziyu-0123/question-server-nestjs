import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AnswerDocument = HydratedDocument<Answer>;

// 单次访谈的 token 用量（嵌套文档需独立 @Schema 类，避免内联对象类型推断错误）
@Schema()
export class AnswerUsage {
  @Prop({ required: true })
  prompt: number;

  @Prop({ required: true })
  completion: number;

  @Prop({ required: true })
  total: number;
}

@Schema({ timestamps: true })
export class Answer {
  @Prop({ required: true })
  questionId: string;

  @Prop()
  answerList?: {
    componentId: string;
    value: string;
  }[];

  @Prop()
  conversationList?: {
    role: 'interviewer' | 'interviewee';
    content: string;
  }[];

  @Prop({ type: AnswerUsage })
  usage?: AnswerUsage;
}
export const AnswerSchema = SchemaFactory.createForClass(Answer);

// 高频访问路径：按问卷查询答卷并按创建时间倒序分页（count/findAll 共用）
AnswerSchema.index({ questionId: 1, createdAt: -1 });
