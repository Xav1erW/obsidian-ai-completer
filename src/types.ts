export interface RewriteRequest {
	instructions: string;
	selectedText: string;
	beforeText: string;
	afterText: string;
	noteTitle?: string;
}

export interface LLMProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	models: string[];
	lastModelSync?: string;
}

export interface ProviderSelection {
	providerId: string;
	model: string;
}
