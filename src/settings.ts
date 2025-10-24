import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AICompleterPlugin from './main';

export interface AICompleterSettings {
	apiKey: string;
	baseUrl: string;
	model: string;
	temperature: number;
	maxContextCharacters: number;
	systemPrompt: string;
	instructionsPlaceholder: string;
}

export const DEFAULT_SETTINGS: AICompleterSettings = {
	apiKey: '',
	baseUrl: 'https://api.openai.com/v1',
	model: 'gpt-4o-mini',
	temperature: 0.3,
	maxContextCharacters: 800,
	systemPrompt:
		'You are an assistant that helps users improve Markdown notes. When you rewrite text, keep the meaning of the original passage, preserve Markdown formatting, and follow the user instructions precisely.',
	instructionsPlaceholder:
		'Example: Make the tone more professional while keeping all Markdown formatting.',
};

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

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Used for OpenAI-compatible APIs. Leave empty to rely on the OPENAI_API_KEY environment variable.')
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ apiKey: value.trim() });
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('Base URL of your OpenAI-compatible API, e.g. https://api.openai.com/v1.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.baseUrl)
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ baseUrl: value.trim() });
					}),
			);

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model name (e.g. gpt-4o-mini or any model served by your provider).')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.model)
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ model: value.trim() });
					}),
			);

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName('Test API key')
			.setDesc('Send a lightweight request to confirm the current configuration is valid.')
			.addButton((button) => {
				button.setButtonText('Test connectivity');
				button.onClick(async () => {
					const originalText = button.buttonEl.textContent ?? '';
					button.setDisabled(true);
					button.setButtonText('Testing…');
					try {
						await this.plugin.getClient().testConnection();
						new Notice('API key works.');
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
}
