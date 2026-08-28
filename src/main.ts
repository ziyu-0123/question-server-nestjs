import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // 路由全局前缀
  await app.listen(process.env.PORT ?? 3005);
}
await bootstrap();
