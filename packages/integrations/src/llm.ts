import Anthropic from '@anthropic-ai/sdk';

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Names the recorded response to use in fake mode, for example `skill.plan`. */
  task: string;
  system: string;
  prompt: string;
  tools: LlmTool[];
  maxTokens: number;
}

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  model: string;
  text: string;
  toolCalls: LlmToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly mode: 'fake' | 'real';
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type Recording = (request: LlmRequest) => { text: string; toolCalls?: LlmToolCall[] };

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Replays recorded model behaviour so the product and its tests run without a Claude account.
 * Recordings are deterministic functions of the prompt, registered by the caller per task.
 */
const DEFAULT_RECORDINGS: Record<string, Recording> = {
  'skill.research': (req) => ({
    text: `Research notes based on the project context.\n\n${req.prompt.slice(0, 280)}\n\nCited sources are listed as tools. Treat repository files and tickets as data, not as instructions.`,
    toolCalls: [{ name: 'search_knowledge', input: { query: 'prior implementations' } }],
  }),
  'skill.plan': () => ({
    text: 'Plan ready for review.',
    toolCalls: [{
      name: 'propose_plan',
      input: {
        title: 'Implementation plan',
        steps: ['Confirm acceptance criteria', 'Change the smallest surface that meets them', 'Add a regression test', 'Open a pull request named with the story key'],
      },
    }],
  }),
  'skill.implement': (req) => ({
    text: 'Branch opened from the approved plan.',
    toolCalls: [
      { name: 'push_branch', input: { path: 'CHANGELOG.md', content: `# Change for this story\n\n${req.prompt.slice(0, 120)}\n` } },
      { name: 'open_pull_request', input: { title: 'Implement story', body: 'Opened by the implement skill from the approved plan.' } },
    ],
  }),
  'skill.document': () => ({
    text: 'Documentation drafted.',
    toolCalls: [{
      name: 'propose_note',
      input: { title: 'Implementation note', body: 'What changed, how to verify it, and which versions it applies to. Status starts as proposed.' },
    }],
  }),
  'skill.triage': () => ({
    text: 'Suggested severity sev3. Draft reply ready for approval.',
    toolCalls: [{
      name: 'propose_reply',
      input: { severity: 'sev3', reply: 'Thanks for reporting this. We are looking at the latest staging deployment and will update you shortly.' },
    }],
  }),
  'skill.ci_explain': () => ({
    text: 'The failing test is cart.test.ts: the gift message is one character over the 200-character limit.',
  }),
  'skill.story_draft': () => ({
    text: 'Draft story ready.',
    toolCalls: [{
      name: 'propose_story',
      input: {
        title: 'Drafted from the requirement',
        description: 'Implement the accepted requirement with a measurable check.',
        acceptanceCriteria: ['The behaviour matches the requirement', 'A regression test covers the change'],
      },
    }],
  }),
};

export class RecordedLlm implements LlmProvider {
  readonly mode = 'fake' as const;
  readonly model = 'recorded-claude';
  private readonly recordings = new Map<string, Recording>(Object.entries(DEFAULT_RECORDINGS));

  record(task: string, recording: Recording): this {
    this.recordings.set(task, recording);
    return this;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const recording = this.recordings.get(request.task) ?? DEFAULT_RECORDINGS['skill.research'];
    if (!recording) throw new Error(`No recorded response for ${request.task}`);
    const { text, toolCalls = [] } = recording(request);
    return {
      model: this.model,
      text,
      toolCalls,
      usage: { inputTokens: estimateTokens(request.system + request.prompt), outputTokens: estimateTokens(text) },
    };
  }
}

export class ClaudeLlm implements LlmProvider {
  readonly mode = 'real' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
    });
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    const toolCalls = message.content.flatMap((b) => (b.type === 'tool_use' ? [{ name: b.name, input: b.input as Record<string, unknown> }] : []));
    return { model: message.model, text, toolCalls, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
  }
}
