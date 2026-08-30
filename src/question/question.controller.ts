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
import { type Request } from 'express';
import { QuestionDto } from './dto/question.dto.js';
import { QuestionService } from './question.service.js';

@Controller('question')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

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
    @Query('isDeleted') isDeleted: boolean = false,
    @Query('isStar') isStar: boolean = false,
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;

    const list = await this.questionService.findAllList({
      keyword,
      page,
      pageSize,
      isDeleted,
      isStar,
      author: username,
    });

    const count = await this.questionService.countAll({
      keyword,
      author: username,
      isDeleted,
      isStar,
    });

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
  updateOne(
    @Param('id') id: string,
    @Body() questionDto: QuestionDto,
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;
    return this.questionService.update(id, questionDto, username);
  }

  @Delete(':id')
  deleteOne(
    @Param('id') id: string,
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;
    return this.questionService.delete(id, username);
  }

  @Delete()
  deleteMany(
    @Body() body: { ids: string[] },
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;
    const { ids = [] } = body;
    return this.questionService.deleteMany(ids, username);
  }
}
