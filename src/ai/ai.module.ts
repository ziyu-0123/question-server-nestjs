import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { UserModule } from '../user/user.module.js';
import { QuestionModule } from '../question/question.module.js';
import { AnswerModule } from '../answer/answer.module.js';

@Module({
  imports: [UserModule, QuestionModule, AnswerModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule { }
