export interface AnswerItem {
  componentId: string;
  value: string;
}

export class CreateAnswerDto {
  readonly questionId: string;
  readonly answerList: AnswerItem[];
}
