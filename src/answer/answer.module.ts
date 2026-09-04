import { Module } from '@nestjs/common';
import { AnswerService } from './answer.service.js';
import { AnswerController } from './answer.controller.js';
import { MongooseModule } from '@nestjs/mongoose';
import { Answer, AnswerSchema } from './schemas/answer.schema.js';
import { Question, QuestionSchema } from '../question/schemas/question.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Answer.name, schema: AnswerSchema },
      { name: Question.name, schema: QuestionSchema },
    ]),
  ],
  exports: [AnswerService],
  providers: [AnswerService],
  controllers: [AnswerController],
})
export class AnswerModule { }
