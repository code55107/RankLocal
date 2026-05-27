import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AnthropicService {
  private readonly log = new Logger(AnthropicService.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  /**
   * Single-shot completion. Returns the concatenated text of the assistant
   * response, or `null` if anything goes wrong (network, quota, parse) — the
   * pipeline's plan step falls back to template recommendations in that case.
   */
  async complete(args: {
    system: string;
    user: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string | null> {
    try {
      const response = await this.client.messages.create({
        model: args.model ?? 'claude-haiku-4-5-20251001',
        max_tokens: args.maxTokens ?? 2048,
        temperature: args.temperature ?? 0.3,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return text || null;
    } catch (err) {
      this.log.warn(`Anthropic call failed: ${(err as Error).message}`);
      return null;
    }
  }
}
