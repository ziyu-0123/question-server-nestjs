import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { TransformInterceptor } from './transform/transform.interceptor.js';
import { HttpExceptionFilter } from './http-exception/http-exception.filter.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // 路由全局前缀
  app.useGlobalInterceptors(new TransformInterceptor()); // 全局响应拦截器
  app.useGlobalFilters(new HttpExceptionFilter()); // 全局异常过滤器
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
  });

  // Swagger 接口文档（访问 /api/docs）
  const config = new DocumentBuilder()
    .setTitle('AskFlow API')
    .setDescription('AI 问卷 / 访谈平台后端接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3005);
}
await bootstrap();
