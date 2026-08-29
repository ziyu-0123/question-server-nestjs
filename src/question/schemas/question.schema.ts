import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import {HydratedDocument} from 'mongoose';

export type QuestionDocument = HydratedDocument<Question>;

@Schema({
  timestamps: true, // 自动添加 createdAt 和 updatedAt 字段
})
export class Question {
  @Prop({required: true})
  title: string;

  @Prop()
  desc: string;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);
