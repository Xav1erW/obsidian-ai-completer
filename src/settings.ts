import {
	App,
	ButtonComponent,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type AICompleterPlugin from './main';
import type { LLMProvider } from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PROVIDER_ID = 'openai-default';

export interface AICompleterSettings {
	providers: LLMProvider[];
	activeProviderId: string | null;
	activeModel: string;
	temperature: number;
	maxContextCharacters: number;
	systemPrompt: string;
	instructionsPlaceholder: string;
}

interface LegacySettings {
	apiKey?: string;
	baseUrl?: string;
	model?: string;
	temperature?: number;
	maxContextCharacters?: number;
	systemPrompt?: string;
	instructionsPlaceholder?: string;
}

export const DEFAULT_SETTINGS: AICompleterSettings = {
	providers: [
		{
			id: DEFAULT_PROVIDER_ID,
			name: 'OpenAI',
			baseUrl: DEFAULT_BASE_URL,
			apiKey: '',
			models: ['gpt-4o-mini'],
		},
	],
	activeProviderId: DEFAULT_PROVIDER_ID,
	activeModel: 'gpt-4o-mini',
	temperature: 0.3,
	maxContextCharacters: 800,
	systemPrompt:
		'You are an assistant that helps users improve Markdown notes. When you rewrite text, keep the meaning of the original passage, preserve Markdown formatting, and follow the user instructions precisely.',
	instructionsPlaceholder:
		'Example: Make the tone more professional while keeping all Markdown formatting.',
};

export function createEmptyProvider(name = 'New Provider'): LLMProvider {
	return {
		id: generateId('provider'),
		name,
		baseUrl: DEFAULT_BASE_URL,
		apiKey: '',
		models: [],
	};
}

export function migrateSettings(
	raw: Partial<AICompleterSettings & LegacySettings> | null | undefined,
): AICompleterSettings {
	const data = raw ?? {};

	let providers: LLMProvider[] = [];
	if (Array.isArray(data.providers) && data.providers.length > 0) {
		providers = sanitizeProviders(data.providers);
	} else if (data.baseUrl || data.apiKey || data.model) {
		const legacyProvider: Partial<LLMProvider> = {
			id: DEFAULT_PROVIDER_ID,
			name: 'Default Provider',
			baseUrl: data.baseUrl,
			apiKey: data.apiKey,
			models: data.model ? [data.model] : [],
		};
		providers = sanitizeProviders([legacyProvider]);
	} else {
		providers = DEFAULT_SETTINGS.providers.map(cloneProvider);
	}

	if (providers.length === 0) {
		providers = [createEmptyProvider('Default Provider')];
	}

	const providerMap = new Map<string, LLMProvider>();
	const sanitizedProviders = providers.map((provider) => {
		let id = provider.id.trim();
		while (!id || providerMap.has(id)) {
			id = generateId('provider');
		}
		const sanitized = { ...provider, id };
		providerMap.set(id, sanitized);
		return sanitized;
	});

	const activeProviderIdCandidate =
		typeof data.activeProviderId === 'string' ? data.activeProviderId.trim() : sanitizedProviders[0]?.id ?? null;
	const activeProvider = activeProviderIdCandidate
		? sanitizedProviders.find((provider) => provider.id === activeProviderIdCandidate) ?? sanitizedProviders[0]
		: sanitizedProviders[0];
	const activeProviderId = activeProvider?.id ?? sanitizedProviders[0]?.id ?? null;

	const providedModel = typeof data.activeModel === 'string' ? data.activeModel.trim() : '';
	const activeModel =
		providedModel || activeProvider?.models?.[0] || DEFAULT_SETTINGS.activeModel || sanitizedProviders[0]?.models?.[0] || '';

	const temperature = clampNumber(data.temperature, DEFAULT_SETTINGS.temperature, 0, 1);
	const maxContextCharacters =
		typeof data.maxContextCharacters === 'number' && Number.isFinite(data.maxContextCharacters) && data.maxContextCharacters >= 0
			? Math.round(data.maxContextCharacters)
			: DEFAULT_SETTINGS.maxContextCharacters;

	const systemPrompt = coerceString(data.systemPrompt, DEFAULT_SETTINGS.systemPrompt);
	const instructionsPlaceholder = coerceString(data.instructionsPlaceholder, DEFAULT_SETTINGS.instructionsPlaceholder);

	return {
		providers: sanitizedProviders,
		activeProviderId,
		activeModel,
		temperature,
		maxContextCharacters,
		systemPrompt,
		instructionsPlaceholder,
	};
}

function sanitizeProviders(providers: Array<Partial<LLMProvider>>): LLMProvider[] {
	return providers
		.map((provider) => sanitizeProvider(provider))
		.filter((provider, index, array) => array.findIndex((item) => item.id === provider.id) === index);
}

function sanitizeProvider(provider: Partial<LLMProvider> | undefined): LLMProvider {
	const base: LLMProvider = {
		id: coerceString(provider?.id, generateId('provider')),
		name: coerceString(provider?.name, 'Provider'),
		baseUrl: coerceString(provider?.baseUrl, DEFAULT_BASE_URL),
		apiKey: coerceString(provider?.apiKey),
		models: sanitizeModels(provider?.models),
		lastModelSync: provider?.lastModelSync?.trim() || undefined,
	};

	if (base.models.length === 0) {
		base.models = [];
	}

	return base;
}

function sanitizeModels(models: unknown): string[] {
	if (!Array.isArray(models)) {
		return [];
	}
	const unique = new Set<string>();
	for (const model of models) {
		const value = typeof model === 'string' ? model.trim() : '';
		if (value) {
			unique.add(value);
		}
	}
	return Array.from(unique);
}

function cloneProvider(provider: LLMProvider): LLMProvider {
	return {
		id: provider.id,
		name: provider.name,
		baseUrl: provider.baseUrl,
		apiKey: provider.apiKey,
		models: [...provider.models],
		lastModelSync: provider.lastModelSync,
	};
}

function coerceString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value.trim() : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const clamped = Math.min(Math.max(value, min), max);
	return Number.isFinite(clamped) ? clamped : fallback;
}

function generateId(prefix: string): string {
	return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

export class AICompleterSettingTab extends PluginSettingTab {
	private readonly plugin: AICompleterPlugin;

	constructor(app: App, plugin: AICompleterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI Completer Settings' });

		this.renderActiveSelectionSection(containerEl);
		this.renderProvidersSection(containerEl);
		this.renderGeneralSettings(containerEl);
		this.renderDiagnostics(containerEl);
	}

	private renderActiveSelectionSection(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv({ cls: 'ai-settings-section' });
		sectionEl.createEl('h3', { text: 'Active provider & model' });
		sectionEl.createEl('p', {
			text: 'Choose the default provider and model used when you open the rewrite modal. You can change them per rewrite as well.',
			cls: 'setting-item-description',
		});

		const providerSetting = new Setting(sectionEl)
			.setName('Default provider')
			.setDesc('Provider used by default in the rewrite modal.');

		const providerDropdown = new DropdownComponent(providerSetting.controlEl);
		const providers = this.plugin.settings.providers;
		for (const provider of providers) {
			providerDropdown.addOption(provider.id, provider.name || provider.baseUrl);
		}
		const activeProviderId = this.plugin.settings.activeProviderId ?? providers[0]?.id ?? '';
		if (activeProviderId && providers.some((provider) => provider.id === activeProviderId)) {
			providerDropdown.setValue(activeProviderId);
		}
		providerDropdown.onChange(async (providerId) => {
			const provider = this.plugin.getProviderById(providerId);
			const fallbackModel = provider?.models[0] ?? '';
			await this.plugin.updateSettings({
				activeProviderId: providerId,
				activeModel: fallbackModel || this.plugin.settings.activeModel,
			});
			this.display();
		});

		const modelSetting = new Setting(sectionEl).setName('Default model');
		const activeProvider = this.plugin.getProviderById(activeProviderId);

		if (activeProvider && activeProvider.models.length > 0) {
			const modelDropdown = new DropdownComponent(modelSetting.controlEl);
			for (const model of activeProvider.models) {
				modelDropdown.addOption(model, model);
			}
			const activeModel =
				activeProvider.models.includes(this.plugin.settings.activeModel) && this.plugin.settings.activeModel
					? this.plugin.settings.activeModel
					: activeProvider.models[0];
			modelDropdown.setValue(activeModel);
			modelDropdown.onChange(async (model) => {
				await this.plugin.updateSettings({ activeModel: model });
			});
		} else {
			modelSetting.setDesc('Enter a model identifier to use by default.');
			const modelInput = new TextComponent(modelSetting.controlEl);
			modelInput.setPlaceholder('gpt-4o-mini');
			modelInput.setValue(this.plugin.settings.activeModel);
			modelInput.onChange(async (value) => {
				await this.plugin.updateSettings({ activeModel: value.trim() });
			});
		}
	}

	private renderProvidersSection(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv({ cls: 'ai-settings-section' });
		sectionEl.createEl('h3', { text: 'Providers' });
		sectionEl.createEl('p', {
			text: 'Manage API providers, base URLs, keys, and available models.',
			cls: 'setting-item-description',
		});

		for (const provider of this.plugin.settings.providers) {
			this.renderProviderCard(sectionEl, provider);
		}

		const addSetting = new Setting(sectionEl).addButton((button) => {
			button.setButtonText('Add provider').setCta();
			button.onClick(async () => {
				const index = this.plugin.settings.providers.length + 1;
				const provider = createEmptyProvider(`Provider ${index}`);
				await this.plugin.updateSettings({
					providers: [...this.plugin.settings.providers, provider],
					activeProviderId: provider.id,
					activeModel: '',
				});
				this.display();
			});
		});
		addSetting.setName(' ');
		addSetting.setDesc('Add a new provider entry with its own base URL, API key, and models.');
	}

	private renderProviderCard(containerEl: HTMLElement, provider: LLMProvider): void {
		const draft = {
			name: provider.name,
			baseUrl: provider.baseUrl,
			apiKey: provider.apiKey,
			modelsText: provider.models.join('\n'),
		};
		let dirty = false;

		const cardEl = containerEl.createDiv({ cls: 'ai-provider-card' });
		const headerEl = cardEl.createDiv({ cls: 'ai-provider-card__header' });
		const titleEl = headerEl.createEl('h4', { text: provider.name || 'Provider' });

		const actionsEl = headerEl.createDiv({ cls: 'ai-provider-card__actions' });
		const saveButton = actionsEl.createEl('button', { text: 'Save', cls: 'mod-cta' });
		saveButton.disabled = true;
		saveButton.onclick = async () => {
			const models = draft.modelsText
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			await this.updateProvider(provider.id, {
				name: draft.name,
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim(),
				models,
			});
			dirty = false;
			this.display();
		};

		const cancelButton = actionsEl.createEl('button', { text: 'Cancel' });
		cancelButton.disabled = true;
		cancelButton.onclick = () => {
			if (!dirty) {
				return;
			}
			this.display();
		};

		const removeButton = actionsEl.createEl('button', { text: 'Remove', cls: 'mod-warning' });
		removeButton.disabled = this.plugin.settings.providers.length <= 1;
		removeButton.onclick = async () => {
			if (this.plugin.settings.providers.length <= 1) {
				new Notice('You must keep at least one provider.');
				return;
			}
			const providers = this.plugin.settings.providers.filter((item) => item.id !== provider.id);
			const activeProviderId =
				this.plugin.settings.activeProviderId === provider.id ? providers[0]?.id ?? null : this.plugin.settings.activeProviderId;
			const activeModel = activeProviderId ? (providers.find((item) => item.id === activeProviderId)?.models[0] ?? '') : '';
			await this.plugin.updateSettings({
				providers,
				activeProviderId,
				activeModel,
			});
			this.display();
		};

		const markDirty = () => {
			if (!dirty) {
				dirty = true;
				saveButton.disabled = false;
				cancelButton.disabled = false;
			}
		};

		new Setting(cardEl)
			.setName('Display name')
			.setDesc('Shown in drop-downs and menus.')
			.addText((text) => {
				text.setPlaceholder('Provider name').setValue(draft.name).onChange((value) => {
					draft.name = value;
					titleEl.setText(value || 'Provider');
					markDirty();
				});
			});

		new Setting(cardEl)
			.setName('Base URL')
			.setDesc('Example: https://api.openai.com/v1 or another OpenAI-compatible endpoint.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_BASE_URL)
					.setValue(draft.baseUrl)
					.onChange((value) => {
						draft.baseUrl = value;
						markDirty();
					}),
			);

		new Setting(cardEl)
			.setName('API key')
			.setDesc('Leave blank to fall back to the OPENAI_API_KEY environment variable.')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(draft.apiKey)
					.onChange((value) => {
						draft.apiKey = value;
						markDirty();
					});
				text.inputEl.type = 'password';
			});

		const modelsSetting = new Setting(cardEl)
			.setName('Models')
			.setDesc('One model identifier per line. Used for selection in the rewrite modal.');

		modelsSetting.addTextArea((textArea) => {
			textArea
				.setValue(draft.modelsText)
				.setPlaceholder('gpt-4o-mini')
				.onChange((value) => {
					draft.modelsText = value;
					markDirty();
				});
			textArea.inputEl.rows = Math.max(3, provider.models.length || 3);
		});

		modelsSetting.addButton((button) => {
			button.setButtonText('Fetch models').onClick(async () => {
				await this.fetchProviderModels(provider, button);
			});
		});

		if (provider.lastModelSync) {
			modelsSetting.setDesc(
				`One model identifier per line. Last synced ${new Date(provider.lastModelSync).toLocaleString()}.`,
			);
		}
	}

	private renderGeneralSettings(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv({ cls: 'ai-settings-section' });
		sectionEl.createEl('h3', { text: 'Rewrite behaviour' });

		new Setting(sectionEl)
			.setName('Temperature')
			.setDesc('Higher values increase creativity. Recommended range 0.0 – 1.0.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.plugin.updateSettings({ temperature: value });
					}),
			);

		new Setting(sectionEl)
			.setName('Context characters')
			.setDesc('Maximum number of characters captured before and after the selection.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.maxContextCharacters.toString())
					.setValue(this.plugin.settings.maxContextCharacters.toString())
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isFinite(parsed) || parsed < 0) {
							return;
						}
						await this.plugin.updateSettings({ maxContextCharacters: Math.round(parsed) });
					}),
			);

		new Setting(sectionEl)
			.setName('System prompt')
			.setDesc('High-level instruction prepended to every request.')
			.addTextArea((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.systemPrompt)
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ systemPrompt: value.trim() });
					}),
			);

		new Setting(sectionEl)
			.setName('Modal input placeholder')
			.setDesc('Helper text displayed inside the rewrite modal.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.instructionsPlaceholder)
					.setValue(this.plugin.settings.instructionsPlaceholder)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ instructionsPlaceholder: value });
					}),
			);
	}

	private renderDiagnostics(containerEl: HTMLElement): void {
		const sectionEl = containerEl.createDiv({ cls: 'ai-settings-section' });
		sectionEl.createEl('h3', { text: 'Diagnostics' });

		new Setting(sectionEl)
			.setName('Test connectivity')
			.setDesc('Send a lightweight request using the active provider and model to verify credentials.')
			.addButton((button) => {
				button.setButtonText('Test provider');
				button.onClick(async () => {
					const provider = this.plugin.getActiveProvider();
					if (!provider) {
						new Notice('No provider configured yet.');
						return;
					}

					const model = this.plugin.settings.activeModel || provider.models[0] || '';
					if (!model) {
						new Notice('Configure at least one model before testing.');
						return;
					}

					const originalText = button.buttonEl.textContent ?? '';
					button.setDisabled(true);
					button.setButtonText('Testing…');
					try {
						await this.plugin.getClient().testConnection(provider, model);
						new Notice('Connection succeeded.');
					} catch (error) {
						const message = error instanceof Error ? error.message : 'Unknown error';
						new Notice(`Test failed: ${message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText(originalText);
					}
				});
			});
	}

	private async updateProvider(providerId: string, patch: Partial<LLMProvider>): Promise<void> {
		const providers = this.plugin.settings.providers.map((provider) =>
			provider.id === providerId ? { ...provider, ...patch } : provider,
		);
		await this.plugin.updateSettings({ providers });
	}

	private async fetchProviderModels(provider: LLMProvider, button: ButtonComponent): Promise<void> {
		const spinnerText = button.buttonEl.textContent ?? '';
		button.setDisabled(true);
		button.setButtonText('Fetching…');
		try {
			const models = await this.plugin.getClient().listModels(provider);
			await this.updateProvider(provider.id, { models, lastModelSync: new Date().toISOString() });
			new Notice(`Fetched ${models.length} model${models.length === 1 ? '' : 's'} for ${provider.name}.`);
			this.display();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to fetch models: ${message}`);
		} finally {
			button.setDisabled(false);
			button.setButtonText(spinnerText);
		}
	}
}
