import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { TransformInterceptor } from './transform/transform.interceptor.js';
import { HttpExceptionFilter } from './http-exception/http-exception.filter.js';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // 路由全局前缀
  app.useGlobalInterceptors(new TransformInterceptor()); // 全局响应拦截器
  app.useGlobalFilters(new HttpExceptionFilter()); // 全局异常过滤器
  await app.listen(process.env.PORT ?? 3005);
}
await bootstrap();
