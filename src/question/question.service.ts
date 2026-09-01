import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Question, QuestionDocument } from './schemas/question.schema.js';
import { Answer, AnswerDocument } from '../answer/schemas/answer.schema.js';
import { QuestionDto } from './dto/question.dto.js';
import { nanoid } from 'nanoid';

interface QuestionSearchParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
  isDeleted?: boolean;
  isStar?: boolean | null;
  author?: string;
}

@Injectable()
export class QuestionService {
  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(Answer.name)
    private readonly answerModel: Model<AnswerDocument>,
  ) { }

  async create(username: string) {
    const question = new this.questionModel({
      author: username,
      title: '问卷标题' + Date.now(),
      desc: '问卷描述',
      componentList: [
        {
          fe_id: nanoid(),
          type: 'questionInfo',
          title: '问卷信息',
          props: { title: '问卷标题', desc: '问卷描述' },
        },
      ],
    });
    return await question.save();
  }

  async delete(id: string, author: string) {
    // return await this.questionModel.findByIdAndDelete(id);
    const res = await this.questionModel.findOneAndDelete({ _id: id, author });
    return res;
  }

  async deleteMany(ids: string[], author: string) {
    const res = await this.questionModel.deleteMany({
      _id: { $in: ids },
      author,
    });
    return res;
  }

  // 允许更新的问卷字段白名单：body 只取这些字段入库，
  // 防止客户端注入 author / _id 等字段篡改归属或写入脏数据
  static readonly UPDATABLE_FIELDS = [
    'title',
    'desc',
    'js',
    'css',
    'isPublished',
    'isStar',
    'isDeleted',
    'componentList',
  ] as const;

  async update(id: string, updateData: QuestionDto, author: string) {
    const $set: Partial<Record<(typeof QuestionService.UPDATABLE_FIELDS)[number], unknown>> = {};
    for (const key of QuestionService.UPDATABLE_FIELDS) {
      if (updateData[key] !== undefined) {
        $set[key] = updateData[key];
      }
    }
    return await this.questionModel.updateOne({ _id: id, author }, { $set });
  }

  async findOne(id: string) {
    return await this.questionModel.findById(id);
  }

  async findAllList({
    keyword = '',
    page = 1,
    pageSize = 10,
    isDeleted = false,
    isStar,
    author = '',
  }: QuestionSearchParams) {
    const whereOpt: any = {
      author,
      isDeleted,
    };
    if (isStar !== null) {
      whereOpt.isStar = isStar;
    }
    if (keyword) {
      const reg = new RegExp(keyword, 'i');
      whereOpt.title = { $regex: reg }; //忽略大小写查询
    }
    const questions = await this.questionModel
      .find(whereOpt)
      .sort({ _id: -1 }) //按_id降序排序
      .skip((page - 1) * pageSize) //跳过前(page-1)*pageSize条数据
      .limit(pageSize);

    // 动态统计每份问卷的答卷数量（answerCount 字段从未被维护，以 answers 集合实际数据为准）
    const ids = questions.map(q => String(q._id));
    const counts = await this.answerModel
      .aggregate<{ _id: string; count: number }>([
        { $match: { questionId: { $in: ids } } },
        { $group: { _id: '$questionId', count: { $sum: 1 } } },
      ])
      .exec();
    const countMap = new Map(counts.map(c => [c._id, c.count]));

    return questions.map(q => {
      const obj = q.toObject();
      return { ...obj, answerCount: countMap.get(String(q._id)) ?? 0 };
    });
  }

  async countAll({
    keyword = '',
    author = '',
    isDeleted = false,
    isStar,
  }: QuestionSearchParams) {
    const whereOpt: any = {
      author,
      isDeleted,
    };
    if (isStar !== null) {
      whereOpt.isStar = isStar;
    }
    if (keyword) {
      const reg = new RegExp(keyword, 'i');
      whereOpt.title = { $regex: reg }; //忽略大小写查询
    }
    return await this.questionModel.countDocuments(whereOpt);
  }

  async duplicate(id: string, author: string) {
    const question = await this.questionModel.findById(id);
    if (!question) {
      throw new NotFoundException('问卷不存在');
    }
    const newQuestion = new this.questionModel({
      ...question.toObject(),
      _id: new Types.ObjectId(),
      title: question.title + '副本',
      author,
      isPublished: false,
      isStar: false,
      componentList: question.componentList.map((item) => {
        return {
          ...item,
          fe_id: nanoid(),
        };
      }),
    });
    return await newQuestion.save();
  }
}
