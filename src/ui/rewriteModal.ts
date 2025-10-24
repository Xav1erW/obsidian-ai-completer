import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
} from 'obsidian';
import type { LLMProvider } from '../types';

interface RewriteInvocation {
	instructions: string;
	providerId: string;
	model: string;
	onUpdate: (partial: string, done: boolean) => void;
}

interface PromptOptions {
	selectedText: string;
	placeholder?: string;
	fallbackInstructions: string;
	providers: LLMProvider[];
	initialProviderId: string | null;
	initialModel: string;
	persistSelection?: (providerId: string, model: string) => void | Promise<void>;
	requestRewrite: (options: RewriteInvocation) => Promise<string>;
}

class RewriteFlowModal extends Modal {
	private readonly options: PromptOptions;
	private readonly resolve: (value: string | null) => void;

	private instructionsInput!: TextAreaComponent;
	private generateButton!: ButtonComponent;
	private applyButton!: ButtonComponent;
	private outputInput!: TextAreaComponent;
	private statusEl!: HTMLDivElement;
	private providerDropdown!: DropdownComponent;
	private modelDropdown!: DropdownComponent;
	private customModelInput!: TextComponent;

	private readonly providers: LLMProvider[];
	private selectedProviderId: string;
	private selectedModel: string;

	private submitted = false;
	private isRequesting = false;
	private latestResult: string | null = null;
	private lastPersistedKey: string | null = null;

	constructor(app: App, options: PromptOptions, resolve: (value: string | null) => void) {
		super(app);
		this.options = options;
		this.resolve = resolve;
		this.providers = options.providers;
		this.selectedProviderId = this.resolveInitialProviderId();
		this.selectedModel = this.resolveInitialModel(this.selectedProviderId);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ai-completer-modal');

		contentEl.createEl('h2', { text: 'AI Rewrite' });

		const preview = contentEl.createEl('pre', { cls: 'ai-completer-preview' });
		const maxPreviewLength = 400;
		const trimmed =
			this.options.selectedText.length > maxPreviewLength
				? `${this.options.selectedText.slice(0, maxPreviewLength)}…`
				: this.options.selectedText;
		preview.setText(trimmed);

		this.renderProviderSelection(contentEl);
		this.renderModelSelection(contentEl);

		const instructionSetting = new Setting(contentEl);
		instructionSetting.setName('Describe the rewrite');
		this.instructionsInput = new TextAreaComponent(instructionSetting.controlEl);
		this.instructionsInput.setPlaceholder(
			this.options.placeholder ??
				'Tell the assistant how to change the text—for example adjust tone, add details, or shorten the paragraph.',
		);
		this.instructionsInput.inputEl.rows = 4;
		this.instructionsInput.inputEl.focus();
		this.instructionsInput.inputEl.addEventListener('keydown', (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
				event.preventDefault();
				this.handleGenerate();
			}
		});

		const actionSetting = new Setting(contentEl);
		let generateButtonRef: ButtonComponent | null = null;
		let applyButtonRef: ButtonComponent | null = null;
		actionSetting.addButton((button) => {
			generateButtonRef = button;
			button.setButtonText('Send to AI').setCta().onClick(() => this.handleGenerate());
		});
		actionSetting.addButton((button) => {
			applyButtonRef = button;
			button.setButtonText('Apply to note').setDisabled(true).onClick(() => this.applyResult());
		});
		actionSetting.addExtraButton((button) =>
			button.setIcon('cross').setTooltip('Cancel').onClick(() => this.close()),
		);

		if (!generateButtonRef || !applyButtonRef) {
			throw new Error('Failed to initialize action buttons.');
		}
		this.generateButton = generateButtonRef;
		this.applyButton = applyButtonRef;

		const outputContainer = contentEl.createDiv({ cls: 'ai-completer-output' });
		outputContainer.createEl('label', { text: 'AI response (you can edit before applying)', cls: 'ai-completer-output-label' });
		this.outputInput = new TextAreaComponent(outputContainer);
		this.outputInput.setPlaceholder('Generated rewrite will appear here. You can edit it before applying to your note.');
		this.outputInput.inputEl.rows = 12;
		this.outputInput.setDisabled(true);

		this.statusEl = contentEl.createEl('div', { cls: 'ai-completer-status' });
		this.statusEl.setText('Add instructions and click “Send to AI” to generate a rewrite.');
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (!this.submitted) {
			this.resolve(null);
		}
	}

	private renderProviderSelection(container: HTMLElement): void {
		const providerSetting = new Setting(container).setName('Provider');
		this.providerDropdown = new DropdownComponent(providerSetting.controlEl);

		if (this.providers.length === 0) {
			this.providerDropdown.setDisabled(true);
			return;
		}

		for (const provider of this.providers) {
			this.providerDropdown.addOption(provider.id, provider.name || provider.baseUrl);
		}

		this.providerDropdown.setValue(this.selectedProviderId);
			this.providerDropdown.onChange((providerId) => {
				this.selectedProviderId = providerId;
				this.syncModelForProviderChange();
				this.refreshModelControls();
				void this.persistSelection();
			});
	}

	private renderModelSelection(container: HTMLElement): void {
		const modelSetting = new Setting(container);
		modelSetting.setName('Model');

		this.modelDropdown = new DropdownComponent(modelSetting.controlEl);
		this.customModelInput = new TextComponent(modelSetting.controlEl);
		this.customModelInput.setPlaceholder('Enter custom model ID');
		this.customModelInput.inputEl.addEventListener('blur', () => {
			const value = this.customModelInput.getValue().trim();
			if (value.length === 0) {
				this.customModelInput.setValue(this.selectedModel);
				return;
			}
			this.selectedModel = value;
			this.modelDropdown.setValue(value);
			void this.persistSelection();
		});

		this.refreshModelControls();
	}

	private refreshModelControls(): void {
		if (!this.modelDropdown || !this.customModelInput) {
			return;
		}

		const provider = this.getCurrentProvider();
		this.modelDropdown.selectEl.empty();
		this.modelDropdown.setDisabled(!provider || provider.models.length === 0);

		if (provider && provider.models.length > 0) {
			for (const model of provider.models) {
				this.modelDropdown.addOption(model, model);
			}

			const current =
				provider.models.includes(this.selectedModel) && this.selectedModel
					? this.selectedModel
					: provider.models[0];
			this.selectedModel = current;
			this.modelDropdown.setValue(current);
			this.modelDropdown.onChange((value) => {
				this.selectedModel = value;
				this.customModelInput.setValue(value);
				void this.persistSelection();
			});
			this.customModelInput.setValue(this.selectedModel);
			this.customModelInput.setDisabled(false);
		} else {
			this.modelDropdown.addOption('', 'No stored models');
			this.modelDropdown.setValue('');
			this.modelDropdown.onChange(() => {
				// No-op when disabled
			});
			this.customModelInput.setValue(this.selectedModel);
			this.customModelInput.setDisabled(false);
		}
	}

	private getCurrentProvider(): LLMProvider | undefined {
		return this.providers.find((provider) => provider.id === this.selectedProviderId);
	}

	private resolveInitialProviderId(): string {
		if (this.options.initialProviderId) {
			const exists = this.providers.some((provider) => provider.id === this.options.initialProviderId);
			if (exists) {
				return this.options.initialProviderId;
			}
		}
		return this.providers[0]?.id ?? '';
	}

	private resolveInitialModel(providerId: string): string {
		const provider = this.providers.find((item) => item.id === providerId);
		if (!provider) {
			return this.options.initialModel ?? '';
		}

		const initialModel = this.options.initialModel?.trim() ?? '';
		if (initialModel && (!provider.models.length || provider.models.includes(initialModel))) {
			return initialModel;
		}

		return provider.models[0] ?? initialModel;
	}

	private syncModelForProviderChange(): void {
		const provider = this.getCurrentProvider();
		if (!provider) {
			this.selectedModel = '';
			this.customModelInput?.setValue(this.selectedModel);
			return;
		}

		if (provider.models.length > 0 && !provider.models.includes(this.selectedModel)) {
			this.selectedModel = provider.models[0];
		}

		this.customModelInput?.setValue(this.selectedModel);
		this.refreshModelControls();
	}

	private async persistSelection(): Promise<void> {
		if (!this.options.persistSelection || !this.selectedProviderId) {
			return;
		}

		const key = `${this.selectedProviderId}::${this.selectedModel}`;
		if (key === this.lastPersistedKey) {
			return;
		}
		this.lastPersistedKey = key;
		await this.options.persistSelection(this.selectedProviderId, this.selectedModel);
	}

	private async handleGenerate(): Promise<void> {
		if (this.isRequesting) {
			return;
		}

		if (!this.selectedProviderId) {
			new Notice('Select a provider before requesting a rewrite.');
			return;
		}

		const model = this.selectedModel.trim();
		if (!model) {
			new Notice('Enter a model identifier before requesting a rewrite.');
			return;
		}

		const instructionsRaw = this.instructionsInput.getValue().trim();
		const instructions =
			instructionsRaw.length > 0 ? instructionsRaw : this.options.fallbackInstructions;

		this.isRequesting = true;
		this.latestResult = null;
		this.applyButton.setDisabled(true);
		this.generateButton.setDisabled(true);
		this.generateButton.setButtonText('Requesting…');
		this.statusEl.setText('Contacting the model, streaming response…');
		this.outputInput.setValue('');
		this.outputInput.setDisabled(true);

		try {
			await this.persistSelection();
			const rewritten = await this.options.requestRewrite({
				instructions,
				providerId: this.selectedProviderId,
				model,
				onUpdate: (partial, done) => {
					this.latestResult = partial;
					this.outputInput.setValue(partial);
					if (done) {
						if (partial.trim().length === 0) {
							this.applyButton.setDisabled(true);
							this.statusEl.setText('The response was empty. Adjust the prompt and try again.');
						} else {
							this.applyButton.setDisabled(false);
							this.statusEl.setText('Ready. Review the result and click “Apply to note” when satisfied.');
						}
						this.outputInput.setDisabled(false);
					} else {
						this.statusEl.setText('Receiving response…');
						this.applyButton.setDisabled(true);
						this.outputInput.setDisabled(true);
					}
				},
			});
			this.latestResult = rewritten;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`AI rewrite failed: ${message}`);
			this.statusEl.setText(`Request failed: ${message}`);
			this.applyButton.setDisabled(true);
			this.outputInput.setDisabled(false);
		} finally {
			this.isRequesting = false;
			this.generateButton.setDisabled(false);
			this.generateButton.setButtonText('Send to AI');
		}
	}

	private applyResult(): void {
		const value = this.outputInput.getValue().trim();
		if (!value) {
			new Notice('There is no rewritten text to apply. Adjust your prompt or edit the response first.');
			return;
		}

		this.submitted = true;
		this.resolve(value);
		this.close();
	}
}

export function promptForRewrite(app: App, options: PromptOptions): Promise<string | null> {
	return new Promise((resolve) => {
		new RewriteFlowModal(app, options, resolve).open();
	});
}
