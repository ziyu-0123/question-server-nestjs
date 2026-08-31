import { Controller, Body, Post } from '@nestjs/common';
import { AnswerService } from './answer.service.js';
import { CreateAnswerDto } from './dto/answer.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('answer')
export class AnswerController {
  constructor(
    private readonly answerService: AnswerService,
  ) { }

  @Public()
  @Post()
  async create(@Body() body: CreateAnswerDto) {
    return await this.answerService.create(body);
  }
}
