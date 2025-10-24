import { App, Modal, Notice, Setting, TextAreaComponent, ButtonComponent } from 'obsidian';

interface PromptOptions {
	selectedText: string;
	placeholder?: string;
	fallbackInstructions: string;
	requestRewrite: (instructions: string, onUpdate: (partial: string, done: boolean) => void) => Promise<string>;
}

class RewriteFlowModal extends Modal {
	private readonly options: PromptOptions;
	private readonly resolve: (value: string | null) => void;

	private instructionsInput!: TextAreaComponent;
	private generateButton!: ButtonComponent;
	private applyButton!: ButtonComponent;
	private outputEl!: HTMLPreElement;
	private statusEl!: HTMLDivElement;

	private submitted = false;
	private isRequesting = false;
	private latestResult: string | null = null;

	constructor(app: App, options: PromptOptions, resolve: (value: string | null) => void) {
		super(app);
		this.options = options;
		this.resolve = resolve;
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

		this.outputEl = contentEl.createEl('pre', { cls: 'ai-completer-output' }) as HTMLPreElement;
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

	private async handleGenerate(): Promise<void> {
		if (this.isRequesting) {
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
		this.outputEl.setText('');

		try {
			const rewritten = await this.options.requestRewrite(instructions, (partial, done) => {
				this.latestResult = partial;
				this.outputEl.setText(partial);
				if (done) {
					if (partial.trim().length === 0) {
						this.applyButton.setDisabled(true);
						this.statusEl.setText('The response was empty. Adjust the prompt and try again.');
					} else {
						this.applyButton.setDisabled(false);
						this.statusEl.setText('Ready. Review the result and click “Apply to note” when satisfied.');
					}
				} else {
					this.statusEl.setText('Receiving response…');
					this.applyButton.setDisabled(true);
				}
			});
			this.latestResult = rewritten;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`AI rewrite failed: ${message}`);
			this.statusEl.setText(`Request failed: ${message}`);
			this.applyButton.setDisabled(true);
		} finally {
			this.isRequesting = false;
			this.generateButton.setDisabled(false);
			this.generateButton.setButtonText('Send to AI');
		}
	}

	private applyResult(): void {
		if (!this.latestResult) {
			new Notice('Generate a rewrite before applying it.');
			return;
		}

		this.submitted = true;
		this.resolve(this.latestResult);
		this.close();
	}
}

export function promptForRewrite(app: App, options: PromptOptions): Promise<string | null> {
	return new Promise((resolve) => {
		new RewriteFlowModal(app, options, resolve).open();
	});
}
