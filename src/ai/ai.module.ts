import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [UserModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
