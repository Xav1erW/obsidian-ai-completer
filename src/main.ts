import { Plugin } from 'obsidian';
import {
	AICompleterSettings,
	DEFAULT_SETTINGS,
	AICompleterSettingTab,
	migrateSettings,
	createEmptyProvider,
} from './settings';
import { registerCommands } from './commands';
import { AIClient } from './ai/client';
import type { LLMProvider } from './types';

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
		const raw = await this.loadData();
		this.settings = migrateSettings(raw ?? DEFAULT_SETTINGS);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async updateSettings(update: Partial<AICompleterSettings>): Promise<void> {
		const merged = { ...this.settings, ...update };
		this.settings = migrateSettings(merged);
		await this.saveSettings();
	}

	getActiveProvider(): LLMProvider | null {
		const provider = this.settings.providers.find((item) => item.id === this.settings.activeProviderId);
		return provider ?? this.settings.providers[0] ?? null;
	}

	getProviderById(providerId: string): LLMProvider | undefined {
		return this.settings.providers.find((provider) => provider.id === providerId);
	}

	async ensureProviderExists(): Promise<void> {
		if (this.settings.providers.length === 0) {
			const providers = [createEmptyProvider('Default Provider')];
			await this.updateSettings({ providers });
		}
	}
}
