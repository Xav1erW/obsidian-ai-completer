import { Notice, Editor, MarkdownView, type EditorPosition, type MarkdownFileInfo, type TFile } from 'obsidian';
import type AICompleterPlugin from '../main';
import { promptForRewrite } from '../ui/rewriteModal';
import { collectEditorContext } from '../utils/context';

function assertSelection(editor: Editor): { selectedText: string; from: EditorPosition; to: EditorPosition } | null {
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	if (from.line === to.line && from.ch === to.ch) {
		new Notice('Select the text you want to rewrite first.');
		return null;
	}

	const selectedText = editor.getRange(from, to);
	if (!selectedText || !selectedText.trim()) {
		new Notice('The selected text is empty and cannot be sent to the AI.');
		return null;
	}

	return { selectedText, from, to };
}

function resolveFileFromView(view: MarkdownView | MarkdownFileInfo | null | undefined): TFile | null {
	if (!view) {
		return null;
	}

	if ('file' in view && view.file) {
		return view.file;
	}

	return null;
}

export function registerCommands(plugin: AICompleterPlugin): void {
	plugin.addCommand({
		id: 'ai-completer-rewrite-selection',
		name: 'Rewrite selection with AI',
		hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'i' }],
		editorCallback: async (editor, view) => {
			const selectionInfo = assertSelection(editor);
			if (!selectionInfo) {
				return;
			}

			const { selectedText, from, to } = selectionInfo;
			const context = collectEditorContext(editor, plugin.settings.maxContextCharacters, { from, to });
			const file =
				resolveFileFromView(view) ??
				resolveFileFromView(plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? null);

			const rewritten = await promptForRewrite(plugin.app, {
				selectedText,
				placeholder: plugin.settings.instructionsPlaceholder,
				fallbackInstructions: 'Rewrite this passage to improve clarity while preserving the original meaning.',
				requestRewrite: (instructions, onUpdate) =>
					plugin.getClient().rewriteStreaming(
						{
							instructions,
							selectedText,
							beforeText: context.before,
							afterText: context.after,
							noteTitle: file?.basename,
						},
						onUpdate,
					),
			});

			if (!rewritten) {
				return;
			}

			const startOffset = editor.posToOffset(from);
			editor.replaceRange(rewritten, from, to);
			const endPos = editor.offsetToPos(startOffset + rewritten.length);
			editor.setSelection(from, endPos);
		},
	});
}
