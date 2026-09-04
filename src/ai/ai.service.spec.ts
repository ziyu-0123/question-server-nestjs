import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { z } from 'zod'
import { AiService } from './ai.service.js'
import { UserService } from '../user/user.service.js'
import { QuestionService } from '../question/question.service.js'
import { AnswerService } from '../answer/answer.service.js'

// 白盒测试需访问 private 方法，统一通过该断言（TS private 仅编译期约束，运行时仍可访问）
const internals = (s: AiService) => s as unknown as {
  _collectOpenTextAnswers: (
    answers: { answerList?: { componentId: string; value: string }[] }[],
    componentId: string,
    limit: number
  ) => { items: { text: string; repeat: number }[]; totalCount: number }
  parseJson: (raw: string) => unknown
  normalizeOptions: (type: string, props: Record<string, unknown>) => void
  buildInterviewMessages: (
    question: { title: string; desc?: string; interviewConfig?: { outline: string[] } },
    history: { role: string; content: string }[]
  ) => { role: string; content: string }[]
  chatWithRetry: <T>(client: unknown, model: string, messages: unknown[], schema: z.ZodType<T>) => Promise<T>
  createClient: (apiKey: string, baseUrl: string) => unknown
}

describe('AiService', () => {
  let service: AiService
  let mockUserService: { findByUsername: ReturnType<typeof vi.fn> }
  let mockQuestionService: { findOne: ReturnType<typeof vi.fn> }
  let mockAnswerService: { count: ReturnType<typeof vi.fn>; findAll: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockUserService = { findByUsername: vi.fn() }
    mockQuestionService = { findOne: vi.fn() }
    mockAnswerService = { count: vi.fn(), findAll: vi.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: UserService, useValue: mockUserService },
        { provide: QuestionService, useValue: mockQuestionService },
        { provide: AnswerService, useValue: mockAnswerService },
      ],
    }).compile()

    service = module.get(AiService)
  })

  describe('_collectOpenTextAnswers', () => {
    it('过滤空值、合并相同文本、totalCount 含重复、按最新倒序', () => {
      const answers = [
        {
          answerList: [
            { componentId: 'c1', value: '好' },
            { componentId: 'c1', value: '  好  ' },
            { componentId: 'c1', value: '   ' },
            { componentId: 'c2', value: '别的组件' },
          ],
        },
        { answerList: [{ componentId: 'c1', value: '一般' }] },
      ]

      const res = internals(service)._collectOpenTextAnswers(answers, 'c1', 10)

      expect(res.totalCount).toBe(3)
      expect(res.items).toEqual([
        { text: '一般', repeat: 1 },
        { text: '好', repeat: 2 },
      ])
    })

    it('单条答案截断为 200 字', () => {
      const answers = [{ answerList: [{ componentId: 'c1', value: 'a'.repeat(250) }] }]

      const res = internals(service)._collectOpenTextAnswers(answers, 'c1', 10)

      expect(res.items[0].text.length).toBe(200)
    })

    it('限量取最新 N 条，totalCount 不受限量影响', () => {
      const answers = [
        {
          answerList: [
            { componentId: 'c1', value: 'a' },
            { componentId: 'c1', value: 'b' },
            { componentId: 'c1', value: 'c' },
          ],
        },
      ]

      const res = internals(service)._collectOpenTextAnswers(answers, 'c1', 2)

      expect(res.items).toHaveLength(2)
      expect(res.items[0].text).toBe('c')
      expect(res.items[1].text).toBe('b')
      expect(res.totalCount).toBe(3)
    })
  })

  describe('parseJson', () => {
    it('解析纯 JSON', () => {
      expect(internals(service).parseJson('{"a":1}')).toEqual({ a: 1 })
    })

    it('解析带 json 标记的代码块', () => {
      expect(internals(service).parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    })

    it('解析无语言标记的代码块', () => {
      expect(internals(service).parseJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
    })

    it('非法输入返回 null', () => {
      expect(internals(service).parseJson('not json')).toBeNull()
    })

    it('代码块内容非法返回 null', () => {
      expect(internals(service).parseJson('```json\nnot json\n```')).toBeNull()
    })
  })

  describe('normalizeOptions', () => {
    it('questionRadio 重写 options 的 value 为 itemN', () => {
      const props: Record<string, unknown> = { options: [{ text: 'a' }, { text: 'b' }] }

      internals(service).normalizeOptions('questionRadio', props)

      expect(props.options).toEqual([
        { value: 'item1', text: 'a' },
        { value: 'item2', text: 'b' },
      ])
    })

    it('questionCheckbox 重写 list 的 value 并补 checked', () => {
      const props: Record<string, unknown> = { list: [{ text: 'a' }, { text: 'b' }] }

      internals(service).normalizeOptions('questionCheckbox', props)

      expect(props.list).toEqual([
        { value: 'item1', text: 'a', checked: false },
        { value: 'item2', text: 'b', checked: false },
      ])
    })

    it('其他类型不修改 props', () => {
      const props: Record<string, unknown> = { title: 'x' }

      internals(service).normalizeOptions('questionInput', props)

      expect(props).toEqual({ title: 'x' })
    })
  })

  describe('buildInterviewMessages', () => {
    it('空 history 走开场白，system 含主题与提纲', () => {
      const messages = internals(service).buildInterviewMessages(
        { title: '访谈', desc: '描述', interviewConfig: { outline: ['q1', 'q2'] } },
        []
      )

      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('标题：访谈')
      expect(messages[0].content).toContain('1. q1')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('请开始访谈')
    })

    it('有 history 走续聊并回放对话', () => {
      const history = [
        { role: 'interviewer', content: '你好' },
        { role: 'interviewee', content: '回答' },
      ]

      const messages = internals(service).buildInterviewMessages(
        { title: '访谈', interviewConfig: { outline: [] } },
        history
      )

      expect(messages[1].content).toContain('请继续访谈')
      expect(messages[1].content).toContain('访谈员：你好')
      expect(messages[1].content).toContain('受访者：回答')
    })
  })

  describe('chatWithRetry', () => {
    const schema = z.object({ name: z.string() })

    it('正常输出一次通过', async () => {
      const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"name":"x"}' } }] })
      const client = { chat: { completions: { create } } }

      const res = await internals(service).chatWithRetry(client, 'm', [], schema)

      expect(res).toEqual({ name: 'x' })
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('首次输出非 JSON → 重试后成功', async () => {
      const create = vi.fn()
        .mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"x"}' } }] })
      const client = { chat: { completions: { create } } }

      const res = await internals(service).chatWithRetry(client, 'm', [], schema)

      expect(res).toEqual({ name: 'x' })
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('zod 校验失败 → 重试后成功', async () => {
      const create = vi.fn()
        .mockResolvedValueOnce({ choices: [{ message: { content: '{"name":123}' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '{"name":"ok"}' } }] })
      const client = { chat: { completions: { create } } }

      const res = await internals(service).chatWithRetry(client, 'm', [], schema)

      expect(res).toEqual({ name: 'ok' })
      expect(create).toHaveBeenCalledTimes(2)
    })

    it('连续两次失败 → 抛 ServiceUnavailableException', async () => {
      const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }] })
      const client = { chat: { completions: { create } } }

      await expect(internals(service).chatWithRetry(client, 'm', [], schema)).rejects.toThrow(
        ServiceUnavailableException
      )
      expect(create).toHaveBeenCalledTimes(2)
    })
  })

  describe('prepareInterviewStream', () => {
    it('questionId 空 → BadRequestException', async () => {
      await expect(service.prepareInterviewStream('', [])).rejects.toThrow(BadRequestException)
      await expect(service.prepareInterviewStream('  ', [])).rejects.toThrow(BadRequestException)
    })

    it('问卷不存在 → NotFoundException', async () => {
      mockQuestionService.findOne.mockResolvedValue(null)

      await expect(service.prepareInterviewStream('id', [])).rejects.toThrow(NotFoundException)
    })

    it('非访谈问卷 → BadRequestException', async () => {
      mockQuestionService.findOne.mockResolvedValue({ type: 'survey', isPublished: true, author: 'u' })

      await expect(service.prepareInterviewStream('id', [])).rejects.toThrow(BadRequestException)
    })

    it('未发布 → BadRequestException', async () => {
      mockQuestionService.findOne.mockResolvedValue({ type: 'interview', isPublished: false, author: 'u' })

      await expect(service.prepareInterviewStream('id', [])).rejects.toThrow(BadRequestException)
    })

    it('受访者已回答 20 轮 → BadRequestException', async () => {
      mockQuestionService.findOne.mockResolvedValue({ type: 'interview', isPublished: true, author: 'u' })
      const history = Array.from({ length: 20 }, () => ({ role: 'interviewee', content: 'x' }))

      await expect(service.prepareInterviewStream('id', history)).rejects.toThrow(BadRequestException)
    })

    it('创建者未配置 AI → BadRequestException', async () => {
      mockQuestionService.findOne.mockResolvedValue({ type: 'interview', isPublished: true, author: 'u' })
      mockUserService.findByUsername.mockResolvedValue(null)

      await expect(service.prepareInterviewStream('id', [])).rejects.toThrow(BadRequestException)
    })

    it('正常 → 返回流式闭包', async () => {
      mockQuestionService.findOne.mockResolvedValue({
        type: 'interview',
        isPublished: true,
        author: 'u',
        title: '访谈',
        interviewConfig: { outline: ['q1'] },
      })
      mockUserService.findByUsername.mockResolvedValue({
        aiConfig: { apiKey: 'k', baseUrl: 'https://x', model: 'm' },
      })
      vi.spyOn(internals(service), 'createClient').mockReturnValue({})

      const fn = await service.prepareInterviewStream('id', [])

      expect(typeof fn).toBe('function')
    })
  })
})
