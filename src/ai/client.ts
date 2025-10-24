import { requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings';
import type { AICompleterSettings } from '../settings';
import type { RewriteRequest } from '../types';

interface ChatCompletionsResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	error?: {
		message?: string;
	};
}

interface ChatCompletionsStreamResponse {
	choices?: Array<{
		delta?: {
			content?: string;
		};
		finish_reason?: string | null;
	}>;
	error?: {
		message?: string;
	};
}

export class AIClient {
	private readonly settingsProvider: () => AICompleterSettings;

	constructor(settingsProvider: () => AICompleterSettings) {
		this.settingsProvider = settingsProvider;
	}

	async rewrite(request: RewriteRequest): Promise<string> {
		const result = await this.rewriteStreaming(request, () => {
			// No-op: streaming callback not needed for synchronous usage.
		});
		return result;
	}

	async rewriteStreaming(
		request: RewriteRequest,
		onUpdate: (partial: string, done: boolean) => void,
	): Promise<string> {
		const { systemPrompt } = this.resolvePrompts();
		return this.callChatStream(systemPrompt, this.buildUserPrompt(request), onUpdate);
	}

	async testConnection(): Promise<void> {
		const { systemPrompt } = this.resolvePrompts();
		await this.callChat(systemPrompt, 'Hello');
	}

	private resolvePrompts(): { systemPrompt: string } {
		const settings = this.settingsProvider();
		return {
			systemPrompt: settings.systemPrompt.trim() || DEFAULT_SETTINGS.systemPrompt,
		};
	}

	private getAuthToken(): string {
		const settings = this.settingsProvider();
		const settingsKey = settings.apiKey.trim();
		const envKey =
			typeof process !== 'undefined' && process.env?.OPENAI_API_KEY
				? process.env.OPENAI_API_KEY.trim()
				: '';
		const apiKey = settingsKey || envKey;

		if (!apiKey) {
			throw new Error('Provide an API key in the plugin settings or via the OPENAI_API_KEY environment variable.');
		}

		return apiKey;
	}

	private async callChat(systemPrompt: string, userPrompt: string): Promise<string> {
		const settings = this.settingsProvider();
		const baseUrl = this.resolveBaseUrl(settings);
		const authToken = this.getAuthToken();

		const requestBody = this.buildChatRequestBody(settings, systemPrompt, userPrompt);

		const response = await requestUrl({
			url: `${baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${authToken}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (response.status < 200 || response.status >= 300) {
			const snippet = response.text?.slice(0, 160) ?? 'Unknown error';
			throw new Error(`Request failed (${response.status}): ${snippet}`);
		}

		const data: ChatCompletionsResponse =
			response.json ?? (response.text ? (JSON.parse(response.text) as ChatCompletionsResponse) : {});

		if (data.error?.message) {
			throw new Error(data.error.message);
		}

		const content = data.choices?.[0]?.message?.content;
		if (!content) {
			throw new Error('The AI response was empty. Please try again.');
		}

		return content.trim();
	}

	private async callChatStream(
		systemPrompt: string,
		userPrompt: string,
		onUpdate: (partial: string, done: boolean) => void,
	): Promise<string> {
		const settings = this.settingsProvider();
		const baseUrl = this.resolveBaseUrl(settings);
		const authToken = this.getAuthToken();
		const requestBody = {
			...this.buildChatRequestBody(settings, systemPrompt, userPrompt),
			stream: true,
		};

		if (typeof fetch !== 'function') {
			const fallback = await this.callChat(systemPrompt, userPrompt);
			onUpdate(fallback, true);
			return fallback;
		}

		let response: Response;
		try {
			response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${authToken}`,
				},
				body: JSON.stringify(requestBody),
			});
		} catch (error) {
			const fallback = await this.callChat(systemPrompt, userPrompt);
			onUpdate(fallback, true);
			return fallback;
		}

		if (!response.ok) {
			const snippet = (await response.text()).slice(0, 160) || 'Unknown error';
			throw new Error(`Request failed (${response.status}): ${snippet}`);
		}

		const body = response.body;
		if (!body) {
			const fallback = await this.callChat(systemPrompt, userPrompt);
			onUpdate(fallback, true);
			return fallback;
		}

		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let aggregated = '';
		let completed = false;

		const flush = (done: boolean): void => {
			const trimmed = aggregated.trim();
			completed = done;
			onUpdate(trimmed, done);
		};

		const processEvent = (eventChunk: string): void => {
			const lines = eventChunk.split(/\r?\n/);
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line || !line.startsWith('data:')) {
					continue;
				}

				const data = line.slice(5).trim();
				if (!data) {
					continue;
				}

				if (data === '[DONE]') {
					flush(true);
					throw new StreamCompletionSignal();
				}

				let parsed: ChatCompletionsStreamResponse;
				try {
					parsed = JSON.parse(data) as ChatCompletionsStreamResponse;
				} catch (error) {
					console.error('Failed to parse stream chunk', error);
					continue;
				}

				if (parsed.error?.message) {
					throw new Error(parsed.error.message);
				}

				const delta = parsed.choices?.[0]?.delta?.content ?? '';
				if (delta) {
					aggregated += delta;
					onUpdate(aggregated, false);
				}

				const finishReason = parsed.choices?.[0]?.finish_reason;
				if (finishReason && finishReason !== 'incomplete') {
					flush(true);
					throw new StreamCompletionSignal();
				}
			}
		};

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				let separatorIndex: number;
				while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
					const eventChunk = buffer.slice(0, separatorIndex);
					buffer = buffer.slice(separatorIndex + 2);
					if (eventChunk.trim().length > 0) {
						processEvent(eventChunk);
					}
				}
			}

			const remaining = decoder.decode();
			if (remaining) {
				buffer += remaining;
			}
			if (buffer.trim().length > 0) {
				processEvent(buffer);
			}
		} catch (signal) {
			if (!(signal instanceof StreamCompletionSignal)) {
				throw signal;
			}
		} finally {
			if (typeof reader.releaseLock === 'function') {
				reader.releaseLock();
			}
		}

		if (!aggregated) {
			throw new Error('The AI response was empty. Please try again.');
		}

		const finalResult = aggregated.trim();
		if (!completed) {
			onUpdate(finalResult, true);
		}
		return finalResult;
	}

	private buildUserPrompt(request: RewriteRequest): string {
		const sections: string[] = [];

		if (request.noteTitle) {
			sections.push(`Note title: ${request.noteTitle}`);
		}

		sections.push(`Selected Markdown:\n${request.selectedText}`);

		if (request.beforeText) {
			sections.push(`Leading context (truncated):\n${request.beforeText}`);
		}

		if (request.afterText) {
			sections.push(`Trailing context (truncated):\n${request.afterText}`);
		}

		sections.push(`User instructions:\n${request.instructions}`);
		sections.push('Output requirement: return only the rewritten Markdown without extra commentary.');

		return sections.join('\n\n');
	}

	private buildChatRequestBody(
		settings: AICompleterSettings,
		systemPrompt: string,
		userPrompt: string,
	): Record<string, unknown> {
		return {
			model: settings.model || DEFAULT_SETTINGS.model,
			temperature: settings.temperature ?? DEFAULT_SETTINGS.temperature,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			max_tokens: 1024,
		};
	}

	private resolveBaseUrl(settings: AICompleterSettings): string {
		return (settings.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, '');
	}
}

class StreamCompletionSignal {}
