import { Controller, Get, Query, Post,Param, Patch, Body, HttpException, HttpStatus } from '@nestjs/common';
import { QuestionDto } from './dto/question.dto.js';
import { QuestionService } from './question.service.js';

@Controller('question')
export class QuestionController {
  constructor(
    private readonly questionService: QuestionService,
  ) { }

  @Get('test')
  getTest(): string {
    throw new HttpException('获取数据失败', HttpStatus.BAD_REQUEST);
    // return 'question Test';
  }

  @Post()
  create() {
    return this.questionService.create();
  }

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
    return this.questionService.findOne(id);
  }

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
