import {
  Controller,
  Get,
  Delete,
  Query,
  Post,
  Param,
  Patch,
  Put,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { type Request } from 'express';
import { QuestionDto } from './dto/question.dto.js';
import { QuestionService } from './question.service.js';
import { type QuestionTranslation } from './schemas/question.schema.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('question')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) { }

  // @Get('test')
  // getTest(): string {
  //   throw new HttpException('获取数据失败', HttpStatus.BAD_REQUEST);
  //   // return 'question Test';
  // }

  @Post()
  create(
    @Req() req: Request & { user: { username: string } },
    @Body() body: { type?: 'survey' | 'interview' },
  ) {
    const { username } = req.user;
    return this.questionService.create(username, body?.type);
  }

  @Get()
  async findAll(
    @Query('keyword') keyword: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('isDeleted') isDeleted: boolean = false,
    @Query('isStar') isStar: boolean | null = null,
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

  @Public()
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

  /**
   * 保存某语言的整卷译文（需登录 + 仅作者；已有译文覆盖更新）
   * 入参: Body { lang: string, translation: { title, desc, texts } }，lang 限 en/ja/ko/fr/es/ru
   * 返回: { errno: 0, data: null }；非作者 403；lang 非白名单或译文非法 400
   */
  @Put(':id/translations')
  updateTranslations(
    @Param('id') id: string,
    @Body() body: { lang: string; translation: QuestionTranslation },
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;
    return this.questionService.updateTranslations(
      id,
      username,
      body?.lang,
      body?.translation,
    );
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

  @Post('duplicate/:id')
  duplicate(
    @Param('id') id: string,
    @Req() req: Request & { user: { username: string } },
  ) {
    const { username } = req.user;
    return this.questionService.duplicate(id, username);
  }
}
