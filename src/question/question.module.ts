import { Module } from '@nestjs/common';
import { QuestionController } from './question.controller.js';
import { QuestionService } from './question.service.js';
import { MongooseModule } from '@nestjs/mongoose';
import { Question, QuestionSchema } from './schemas/question.schema.js';
import { Answer, AnswerSchema } from '../answer/schemas/answer.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: Answer.name, schema: AnswerSchema },
    ]),
  ],
  exports: [QuestionService],
  controllers: [QuestionController],
  providers: [QuestionService],
})
export class QuestionModule {}
