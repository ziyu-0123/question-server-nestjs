import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { QuestionModule } from './question/question.module.js';

@Module({
  imports: [QuestionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
