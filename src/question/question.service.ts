import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Question, QuestionDocument } from './schemas/question.schema.js';
import { QuestionDto } from './dto/question.dto.js';
import { nanoid } from 'nanoid';

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
          props: {title: '问卷标题', desc: '问卷描述'},
        },
      ],
    });
    return await question.save();
  }

  async delete(id: string) {
    return await this.questionModel.findByIdAndDelete(id);
  }

  async update(id: string, updateData: QuestionDto) {
    return await this.questionModel.updateOne({ _id: id }, updateData);
  }

  async findOne(id: string) {
    return await this.questionModel.findById(id);
  }

  async findAllList({ keyword = '', page = 1, pageSize = 10 }) {
    const whereOpt: any = {};
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

  async count({ keyword = '' }) {
    const whereOpt: any = {};
    if (keyword) {
      const reg = new RegExp(keyword, 'i');
      whereOpt.title = { $regex: reg }; //忽略大小写查询
    }
    return await this.questionModel.countDocuments(whereOpt);
  }
}
