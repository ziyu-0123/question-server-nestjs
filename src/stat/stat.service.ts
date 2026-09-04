import { Injectable } from '@nestjs/common';
import { QuestionService } from '../question/question.service.js';
import { AnswerService } from '../answer/answer.service.js';
type OptionItem = {
  value: string;
  text: string;
};

type ComponentProps = {
  options?: OptionItem[];
  list?: (OptionItem & { checked?: boolean })[];
};

type ComponentInfo = {
  fe_id: string;
  type: string;
  title: string;
  props: ComponentProps;
};

type QuestionLike = {
  componentList?: ComponentInfo[];
};

type AnswerItem = {
  componentId: string;
  value: string;
};

@Injectable()
export class StatService {
  constructor(
    private readonly questionService: QuestionService,
    private readonly answerService: AnswerService,
  ) { }

  private _getRadioOptText(value: string, props: ComponentProps = {}): string {
    const { options = [] } = props;
    for (const item of options) {
      if (item.value === value) {
        return item.text;
      }
    }
    return '';
  }

  private _getCheckboxOptText(
    value: string,
    props: ComponentProps = {},
  ): string {
    const { list = [] } = props;
    for (const item of list) {
      if (item.value === value) {
        return item.text;
      }
    }
    return '';
  }

  private _genAnswersInfo(
    question: QuestionLike,
    answerList: AnswerItem[] = [],
  ): Record<string, string> {
    const res: Record<string, string> = {};
    const { componentList = [] } = question;

    answerList.forEach((a) => {
      const { componentId, value = '' } = a;
      const comp = componentList.find((c) => c.fe_id === componentId);
      if (!comp) return;

      const { type, props = {} } = comp;
      if (type === 'questionRadio') {
        res[componentId] = this._getRadioOptText(value, props);
      } else if (type === 'questionCheckbox') {
        // 多选值在 C 端以逗号拼接，这里拆开逐项取文案
        const vals = value ? value.split(',') : [];
        res[componentId] = vals
          .map((v) => this._getCheckboxOptText(v, props))
          .filter(Boolean)
          .toString();
      } else {
        res[componentId] = value;
      }
    });

    return res;
  }

  async getQuestionStatListAndCount(
    questionId: string,
    opt: { page: number; pageSize: number },
  ) {
    const noData = { list: [], total: 0 };
    if (!questionId) {
      return noData;
    }
    const q = await this.questionService.findOne(questionId);
    if (q == null) {
      return noData;
    }
    const total = await this.answerService.count(questionId);
    if (total === 0) return noData;
    const answers = await this.answerService.findAll(questionId, opt);
    const list = answers.map((a) => {
      return {
        _id: a._id,
        ...this._genAnswersInfo(q, a.answerList),
      };
    });
    return { list, total };
  }

  async getComponentStat(questionId: string, componentFeId: string) {
    if (!questionId || !componentFeId) return [];

    // 获取问卷
    const q = await this.questionService.findOne(questionId); // 问卷
    if (q == null) return [];

    // 获取组件
    const { componentList = [] } = q;
    const comp = componentList.filter((c) => c.fe_id === componentFeId)[0];
    if (comp == null) return [];

    const { type, props } = comp;
    if (type !== 'questionRadio' && type !== 'questionCheckbox') {
      // 单组件的，只统计单选和多选。其他不统计
      return [];
    }

    // 统计下沉到数据库层：聚合管道按 value 计数，应用层只做 value → text 映射
    const counts = await this.answerService.aggregateComponentStat(questionId, componentFeId);

    const list = counts.map(({ value, count }) => {
      const text =
        type === 'questionRadio'
          ? this._getRadioOptText(value, props)
          : this._getCheckboxOptText(value, props);
      return { name: text, count };
    });

    return list;
  }

  // 访谈答卷列表：每份答卷返回完整聊天记录（统计端访谈视图用）
  async getInterviewAnswerList(
    questionId: string,
    opt: { page: number; pageSize: number },
  ) {
    const noData = { list: [], total: 0 };
    if (!questionId) {
      return noData;
    }
    const q = await this.questionService.findOne(questionId);
    if (q == null) {
      return noData;
    }
    const total = await this.answerService.count(questionId);
    if (total === 0) return noData;
    const answers = await this.answerService.findAll(questionId, opt);
    const list = answers.map((a) => ({
      _id: a._id,
      conversationList: a.conversationList ?? [],
    }));
    return { list, total };
  }
}
