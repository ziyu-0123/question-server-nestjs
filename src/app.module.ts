import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { QuestionModule } from './question/question.module.js';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from './user/user.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AnswerModule } from './answer/answer.module.js';
import { StatModule } from './stat/stat.module.js';
import { AiModule } from './ai/ai.module.js';

@Module({
  imports: [
    QuestionModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        // 优先用 MONGO_URI（云库如 Atlas），否则回退到 HOST/PORT/DATABASE（本地）
        const uri = configService.get<string>('MONGO_URI');
        return {
          uri:
            uri ??
            `mongodb://${configService.get<string>('MONGO_HOST')}:${configService.get<string>('MONGO_PORT')}/${configService.get<string>('MONGO_DATABASE')}`,
        };
      },
      inject: [ConfigService],
    }),
    UserModule,
    AuthModule,
    AnswerModule,
    StatModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
