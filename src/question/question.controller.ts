import { Controller, Get, Query, Param, Patch, Body } from '@nestjs/common';
import { QuestionDto } from './dto/question.dto.js';

@Controller('question')
export class QuestionController {
  @Get()
  findAll(
    @Query('keyword') keyword: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
  ) {
    console.log(keyword, page, pageSize);

    return {
      list: ['a', 'b', 'c'],
      count: 10,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return {
      id,
      title: 'aaa',
      desc: 'bbb',
    };
  }

  // @Get('test')
  // getTest(): string {
  //   return 'question Test';
  // }

  @Patch(':id')
  update(@Param('id') id: string,
    @Body() questionDto: QuestionDto,
  ) {
    console.log(questionDto);
    return {
      id,
      title: 'aaa',
      desc: 'bbb',
    };
  }
}
