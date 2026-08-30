import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Question, QuestionDocument } from './schemas/question.schema.js';
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
  ) {}

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

  async update(id: string, updateData: QuestionDto, author: string) {
    return await this.questionModel.updateOne({ _id: id, author }, updateData);
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
    return await this.questionModel
      .find(whereOpt)
      .sort({ _id: -1 }) //按_id降序排序
      .skip((page - 1) * pageSize) //跳过前(page-1)*pageSize条数据
      .limit(pageSize);
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
