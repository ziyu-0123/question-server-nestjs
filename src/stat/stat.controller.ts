import { Controller, Get, Param, Query } from '@nestjs/common';
import { StatService } from './stat.service.js';
@Controller('stat')
export class StatController {
  constructor(private readonly statService: StatService) { }

  @Get(':questionId')
  async getQuestionStat(
    @Param('questionId') questionId: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
  ) {
    return this.statService.getQuestionStatListAndCount(questionId, {
      page,
      pageSize,
    });
  }

  // 访谈答卷列表（须声明在 :componentFeId 之前，避免 interview 被当作组件 id）
  @Get(':questionId/interview')
  async getInterviewAnswerList(
    @Param('questionId') questionId: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
  ) {
    return this.statService.getInterviewAnswerList(questionId, {
      page,
      pageSize,
    });
  }

  @Get(':questionId/:componentFeId')
  async getComponentStat(
    @Param('questionId') questionId: string,
    @Param('componentFeId') componentFeId: string,
  ) {
    const stat = await this.statService.getComponentStat(
      questionId,
      componentFeId,
    );
    return { stat };
  }
}
