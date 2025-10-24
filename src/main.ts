import { Plugin } from 'obsidian';
import { AICompleterSettings, DEFAULT_SETTINGS, AICompleterSettingTab } from './settings';
import { registerCommands } from './commands';
import { AIClient } from './ai/client';

export default class AICompleterPlugin extends Plugin {
	settings: AICompleterSettings;
	private client: AIClient;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.client = new AIClient(() => this.settings);

		registerCommands(this);
		this.addSettingTab(new AICompleterSettingTab(this.app, this));
	}

	getClient(): AIClient {
		return this.client;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async updateSettings(update: Partial<AICompleterSettings>): Promise<void> {
		this.settings = { ...this.settings, ...update };
		await this.saveSettings();
	}
}
