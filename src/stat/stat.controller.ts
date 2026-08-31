import { Controller, Get, Param, Query } from '@nestjs/common';
import { StatService } from './stat.service.js'
@Controller('stat')
export class StatController {
  constructor(private readonly statService: StatService) { }

  @Get(':questionId')
  async getQuestionStat(@Param('questionId') questionId: string, @Query('page') page: number = 1, @Query('pageSize') pageSize: number = 10) {

    return this.statService.getQuestionStatListAndCount(questionId, { page, pageSize })
  }
}
