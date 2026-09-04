import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AnswerDocument = HydratedDocument<Answer>;

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
}
export const AnswerSchema = SchemaFactory.createForClass(Answer);

// 高频访问路径：按问卷查询答卷并按创建时间倒序分页（count/findAll 共用）
AnswerSchema.index({ questionId: 1, createdAt: -1 });
