import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Answer, AnswerDocument } from './schemas/answer.schema.js';
import { CreateAnswerDto } from './dto/answer.dto.js';
@Injectable()
export class AnswerService {
  constructor(
    @InjectModel(Answer.name)
    private readonly answerModel: Model<AnswerDocument>,
  ) { }

  async create(answerInfo: CreateAnswerDto) {
    if (answerInfo.questionId == null) {
      throw new HttpException('缺少问卷 id', HttpStatus.BAD_REQUEST);
    }
    // 答卷内容至少其一：问卷答卷用 answerList，访谈答卷用 conversationList
    if (answerInfo.answerList == null && answerInfo.conversationList == null) {
      throw new HttpException('缺少答卷内容', HttpStatus.BAD_REQUEST);
    }
    // 只取答卷业务字段入库，防止 body 夹带任意脏字段
    const { questionId, answerList, conversationList } = answerInfo;
    const answer = new this.answerModel({ questionId, answerList, conversationList });
    return await answer.save();
  }

  async count(questionId: string) {
    if (!questionId) {
      return 0
    }
    return await this.answerModel.countDocuments({ questionId });
  }

  async findAll(questionId: string, opt: { page: number, pageSize: number }) {
    if (!questionId) {
      return []
    }
    const { page = 1, pageSize = 10 } = opt;
    const list = await this.answerModel
      .find({ questionId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    return list;
  }
}
