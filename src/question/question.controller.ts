import {
  Controller,
  Get,
  Delete,
  Query,
  Post,
  Param,
  Patch,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { QuestionDto } from './dto/question.dto.js';
import { QuestionService } from './question.service.js';

@Controller('question')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) { }

  // @Get('test')
  // getTest(): string {
  //   throw new HttpException('获取数据失败', HttpStatus.BAD_REQUEST);
  //   // return 'question Test';
  // }

  @Post()
  create(@Req() req: Request & { user: { username: string } }) {
    const { username } = req.user;
    return this.questionService.create(username);
  }

  @Get()
  async findAll(
    @Query('keyword') keyword: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
  ) {

    const list = await this.questionService.findAllList({ keyword, page, pageSize });

    const count = await this.questionService.count({ keyword });

    return {
      list,
      count,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionService.findOne(id);
  }

  @Patch(':id')
  updateOne(@Param('id') id: string, @Body() questionDto: QuestionDto) {
    return this.questionService.update(id, questionDto);
  }

  @Delete(':id')
  deleteOne(@Param('id') id: string) {
    return this.questionService.delete(id);
  }
}
