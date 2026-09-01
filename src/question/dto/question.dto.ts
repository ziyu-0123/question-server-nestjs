import { Question } from '../schemas/question.schema.js';

// 问卷可更新字段（与 question.service.update 的白名单一致）
export class QuestionDto {
  readonly title?: string;
  readonly desc?: string;
  readonly js?: string;
  readonly css?: string;
  readonly isPublished?: boolean;
  readonly isStar?: boolean;
  readonly isDeleted?: boolean;
  readonly componentList?: Question['componentList'];
}
