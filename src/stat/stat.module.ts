import { Module } from '@nestjs/common';
import { StatService } from './stat.service.js';
import { StatController } from './stat.controller.js';
import { QuestionModule } from '../question/question.module.js';
import { AnswerModule } from '../answer/answer.module.js';

@Module({
  imports: [QuestionModule, AnswerModule],
  exports: [StatService],
  providers: [StatService],
  controllers: [StatController],
})
export class StatModule {}
