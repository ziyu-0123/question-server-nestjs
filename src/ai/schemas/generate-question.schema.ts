import { z } from 'zod';

// ===== LLM 输出结构的 zod 校验 schema =====
// 与前端 7 种问卷组件的 props 类型一一对应（QuestionComponents/*/interface.ts）
// 注意：radio 的 options / checkbox 的 list 只要求 LLM 给出 text，
// value 由后端规范化生成（见 ai.service.ts），避免统计聚合 key 非法

const questionInfoProps = z.object({
  title: z.string(),
  desc: z.string(),
});

const questionTitleProps = z.object({
  text: z.string(),
  level: z.number().int().min(1).max(5),
  isCenter: z.boolean(),
});

const questionParagraphProps = z.object({
  text: z.string(),
  isCenter: z.boolean(),
});

const questionInputProps = z.object({
  title: z.string(),
  placeholder: z.string(),
});

const questionTextareaProps = z.object({
  title: z.string(),
  placeholder: z.string(),
});

const optionTextSchema = z.object({ text: z.string() });

const questionRadioProps = z.object({
  title: z.string(),
  isVertical: z.boolean(),
  options: z.array(optionTextSchema).min(2).max(6),
});

const questionCheckboxProps = z.object({
  title: z.string(),
  isVertical: z.boolean(),
  list: z.array(optionTextSchema).min(3).max(8),
});

// 按 type 区分 props 结构（discriminated union）
// 供"生成问卷"与"单题优化"共用：前者校验 componentList，后者校验入参 component
export const componentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('questionInfo'), props: questionInfoProps }),
  z.object({ type: z.literal('questionTitle'), props: questionTitleProps }),
  z.object({ type: z.literal('questionParagraph'), props: questionParagraphProps }),
  z.object({ type: z.literal('questionInput'), props: questionInputProps }),
  z.object({ type: z.literal('questionTextarea'), props: questionTextareaProps }),
  z.object({ type: z.literal('questionRadio'), props: questionRadioProps }),
  z.object({ type: z.literal('questionCheckbox'), props: questionCheckboxProps }),
])

// 各组件类型的 props schema 映射，供按入参 type 选取（如单题优化的输出校验）
export const propsSchemas: Record<string, z.ZodTypeAny> = {
  questionInfo: questionInfoProps,
  questionTitle: questionTitleProps,
  questionParagraph: questionParagraphProps,
  questionInput: questionInputProps,
  questionTextarea: questionTextareaProps,
  questionRadio: questionRadioProps,
  questionCheckbox: questionCheckboxProps,
};

// LLM 完整输出：{ title, desc, componentList }
export const generateQuestionSchema = z.object({
  title: z.string().min(1),
  desc: z.string(),
  componentList: z.array(componentSchema).min(3),
});

// 多语言翻译的输入/输出结构：与原问卷同构，仅文案字段变译文。
// 无 min(3)——翻译不设组件数门槛；入参与输出共用（zod strip 自动剥离
// props 中的 value/checked 等结构字段，进提示词的天然是纯文案投影）
export const translateQuestionSchema = z.object({
  title: z.string().min(1),
  desc: z.string(),
  componentList: z.array(componentSchema),
});

export type GenerateQuestionResult = z.infer<typeof generateQuestionSchema>;

export type TranslateQuestionResult = z.infer<typeof translateQuestionSchema>;

export type ComponentInput = z.infer<typeof componentSchema>;
