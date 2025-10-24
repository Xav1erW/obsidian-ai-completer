# Obsidian AI Completer

Improve your notes without leaving the editor. **Obsidian AI Completer** lets you select a block of text, describe how you’d like it to change, and preview AI-generated rewrites before deciding whether to apply them.

![Demo](./docs/demo.gif)

## Features

- ✍️ **Inline rewrite** – Trigger `Rewrite selection with AI` (default hotkey `Ctrl+Shift+I`) to open the AI modal for the current selection.
- 🗣️ **Instruction driven** – Tell the model exactly what to do; empty instructions fall back to a safe “clarify without changing meaning” prompt.
- 👀 **Preview first** – The modal animates the response into view; you can regenerate until satisfied and decide when to apply.
- 🧠 **Context aware** – Configurable surrounding context ensures rewrites respect nearby content and note titles.
- ⚙️ **Flexible backend** – Works with OpenAI-compatible APIs. Configure base URL, model, temperature, and system prompt in settings.
- ✅ **Connectivity test** – One-click API Key tester in the settings page.

## Installation

1. Clone the repo into your vault’s plugin folder:  
   `git clone https://github.com/Xav1erW/obsidian-ai-completer.git`
2. Install dependencies: `npm install`
3. Build once (or run in watch mode): `npm run build` / `npm run dev`
4. In Obsidian, enable the plugin under **Settings → Community plugins**.
5. Open **Settings → Obsidian AI Completer** to set your API key and preferences.

## Usage

1. Highlight the text you want to refine.
2. Press the hotkey (`Ctrl+Shift+I`) or run the command **Rewrite selection with AI**.
3. Describe the changes you’d like; send the request to generate a preview.
4. Review the streamed result, regenerate if needed, then apply to replace the selection.

## Configuration

All settings live under **Settings → Obsidian AI Completer**:

- `API Key` – Stored locally; can be left empty if you rely on the `OPENAI_API_KEY` environment variable.
- `Base URL` – HTTP endpoint of an OpenAI-compatible service (defaults to `https://api.openai.com/v1`).
- `Model` – Chat/completions model name (e.g., `gpt-4o-mini`).
- `Temperature` – Controls creativity; default `0.3`.
- `Context characters` – Characters captured before/after the selection.
- `System prompt` – System message applied to every request.
- `Modal input placeholder` – Placeholder inside the modal input field.
- `Test API key` – Sends a simple probe to check credentials quickly.

## Development

This project follows the standard Obsidian plugin toolchain.

```bash
npm install
npm run dev   # builds in watch mode
npm run build # production bundle
```

The source lives in `src/`, bundled to `main.js` via esbuild. TypeScript is configured with strict defaults; prefer keeping feature logic outside `main.ts`.

## Release checklist

1. Update `manifest.json` version and `versions.json` mapping.
2. Run `npm run build` to produce the latest `main.js` bundle.
3. Create a GitHub release with `manifest.json`, `main.js`, and `styles.css` attached.
4. Share the release or submit to the Obsidian community catalog.

## License

MIT © [Xav1erW](https://github.com/Xav1erW)
