import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Answer, AnswerDocument } from './schemas/answer.schema.js';
import { Question, QuestionDocument } from '../question/schemas/question.schema.js';
import { CreateAnswerDto } from './dto/answer.dto.js';
@Injectable()
export class AnswerService {
  constructor(
    @InjectModel(Answer.name)
    private readonly answerModel: Model<AnswerDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
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
    const { questionId, answerList, conversationList, usage } = answerInfo;
    const answer = new this.answerModel({ questionId, answerList, conversationList, usage });
    const saved = await answer.save();
    // 反范式维护答卷计数：列表页直接读 answerCount，避免每页聚合统计
    await this.questionModel.updateOne({ _id: questionId }, { $inc: { answerCount: 1 } });
    return saved;
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

  // 统计选择题各 value 的答卷计数（统计下沉到数据库层，避免全量拉取到内存）
  // 入参: questionId（问卷 id）、componentFeId（单选/多选组件 fe_id）
  // 返回: [{ value: 'item1', count: 3 }, ...]（多选值已按逗号拆开逐项计数）
  async aggregateComponentStat(questionId: string, componentFeId: string) {
    return await this.answerModel.aggregate<{ value: string; count: number }>([
      { $match: { questionId } },
      { $unwind: '$answerList' },
      { $match: { 'answerList.componentId': componentFeId } },
      // 仅统计非空字符串 value 的答案项（与旧逻辑 value ? split(',') : [] 对齐）
      { $match: { 'answerList.value': { $type: 'string', $ne: '' } } },
      // 多选值以逗号拼接，拆成数组后逐个计数
      { $project: { values: { $split: ['$answerList.value', ','] } } },
      { $unwind: '$values' },
      { $group: { _id: '$values', count: { $sum: 1 } } },
      { $project: { _id: 0, value: '$_id', count: 1 } },
    ]);
  }
}
