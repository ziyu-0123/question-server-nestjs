// AI 模型配置入参（用户自带 Key 模式）
export class AiConfigDto {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}
