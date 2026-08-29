import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Question, QuestionDocument } from './schemas/question.schema.js';

@Injectable()
export class QuestionService {
  constructor(
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
  ) { }

  async create() {
    const question = new this.questionModel({
      title: 'title' + Date.now(),
      desc: 'desc',
    });
    return await question.save();
  }

  async findOne(id: string) {
    return await this.questionModel.findById(id);
  }
}
