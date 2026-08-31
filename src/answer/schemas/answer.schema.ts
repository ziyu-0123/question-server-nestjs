import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AnswerDocument = HydratedDocument<Answer>;

@Schema({ timestamps: true })
export class Answer {
  @Prop({ required: true })
  questionId: string;

  @Prop({ required: true })
  answerList: {
    componentId: string;
    value: string;
  }[]
}
export const AnswerSchema = SchemaFactory.createForClass(Answer);
