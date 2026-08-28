import { Module } from '@nestjs/common';
import { QuestionController } from './question.controller.js';
import { QuestionService } from './question.service.js';

@Module({
  controllers: [QuestionController],
  providers: [QuestionService]
})
export class QuestionModule {}
