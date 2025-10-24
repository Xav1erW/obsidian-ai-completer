import type { Editor, EditorPosition } from 'obsidian';

export interface SurroundingContext {
	before: string;
	after: string;
}

export function collectEditorContext(
	editor: Editor,
	limit: number,
	anchors: { from: EditorPosition; to: EditorPosition },
): SurroundingContext {
	const doc = editor.getValue();
	const fromOffset = editor.posToOffset(anchors.from);
	const toOffset = editor.posToOffset(anchors.to);

	if (!limit || limit <= 0) {
		return { before: '', after: '' };
	}

	const beforeStart = Math.max(0, fromOffset - limit);
	const afterEnd = Math.min(doc.length, toOffset + limit);

	const before = doc.slice(beforeStart, fromOffset).trimEnd();
	const after = doc.slice(toOffset, afterEnd).trimStart();

	return { before, after };
}
