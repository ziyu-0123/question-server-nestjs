export interface AnswerItem {
  componentId: string;
  value: string;
}

export interface ConversationItem {
  role: 'interviewer' | 'interviewee';
  content: string;
}

export class CreateAnswerDto {
  readonly questionId: string;
  readonly answerList?: AnswerItem[];
  readonly conversationList?: ConversationItem[];
}
