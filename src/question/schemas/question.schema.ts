import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

// 单个组件的文案译文（按 fe_id 索引，仅含该组件类型有文案值的字段）
export interface ComponentTextTranslation {
  title?: string;
  desc?: string;
  text?: string;
  placeholder?: string;
  options?: string[]; // questionRadio 选项 text 数组，顺序与主版本一致
  list?: string[]; // questionCheckbox 选项 text 数组，顺序与主版本一致
}

// 单个语言的整卷译文：只存"文案差异"，不存结构；fe_id 未命中时 C 端回退主版本文案
export interface QuestionTranslation {
  title: string;
  desc: string;
  texts: {
    [fe_id: string]: ComponentTextTranslation;
  };
}

// 访谈配置（嵌套文档需独立 @Schema 类，避免内联对象触发 CannotDetermineTypeError）
@Schema()
export class InterviewConfig {
  @Prop({ type: [String], default: [] })
  outline: string[];
}

export type QuestionDocument = HydratedDocument<Question>;

@Schema({
  timestamps: true, // 自动添加 createdAt 和 updatedAt 字段
})
export class Question {
  @Prop({ required: true })
  title: string;

  @Prop()
  desc: string;

  @Prop()
  js: string;

  @Prop()
  css: string;

  @Prop({ default: false })
  isPublished: boolean;

  @Prop({ default: false })
  isStar: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: 0 })
  answerCount: number;

  @Prop({ required: true })
  author: string;

  // 问卷类型：survey（拖拽问卷，默认）/ interview（AI 访谈）
  @Prop({ default: 'survey' })
  type: 'survey' | 'interview';

  // 访谈配置（仅 interview 类型使用）
  @Prop({ type: InterviewConfig })
  interviewConfig?: InterviewConfig;

  @Prop()
  componentList: {
    fe_id: string;
    type: string;
    title: string;
    isHidden: boolean;
    isLocked: boolean;
    props: object;
  }[];

  // 各语言文案译文（Map 形态无固定 schema，Mixed 文档化足够；
  // 内联对象类型会触发 CannotDetermineTypeError——User.aiConfig 的前车之鉴）
  @Prop({ type: MongooseSchema.Types.Mixed })
  translations?: {
    [lang: string]: QuestionTranslation;
  };
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

// 高频访问路径：按作者查列表 + 回收站过滤 + 倒序分页（findAllList/countAll 共用）
QuestionSchema.index({ author: 1, isDeleted: 1, _id: -1 });
