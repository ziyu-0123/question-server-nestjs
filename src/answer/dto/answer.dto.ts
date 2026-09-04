export interface AnswerItem {
  componentId: string;
  value: string;
}

export interface ConversationItem {
  role: 'interviewer' | 'interviewee';
  content: string;
}

export interface AnswerUsageDto {
  prompt: number;
  completion: number;
  total: number;
}

export class CreateAnswerDto {
  readonly questionId: string;
  readonly answerList?: AnswerItem[];
  readonly conversationList?: ConversationItem[];
  readonly usage?: AnswerUsageDto;
}
