# JSON Editor

A professional JSON editing workspace for [DBX](https://github.com/t8y2/dbx), running as a sandboxed workbench plugin. It offers Code, Tree, and Table views, dual-pane side-by-side editing, formatting, JSON Schema validation, and difference highlighting.

## Features

### Three editing views

Every panel can independently switch between:

- **Tree** — interactive, expandable document tree with inline editing, drag-and-drop reordering, and context menus.
- **Table** — spreadsheet-like view for arrays of objects, with optional flattening of nested properties into separate columns.
- **Text (Code)** — a CodeMirror-powered editor with syntax highlighting, code folding, autocomplete, auto-closing brackets, and an embedded search panel.

### Dual-pane workspace

- Two independently editable panels separated by a draggable splitter; either side can be collapsed or shown full screen.
- **Copy between panels** in either direction, or use one panel as the source for a transform that writes its result to the other.
- **Compare** highlights differences between the two documents and provides previous/next navigation through the changes.

### JSON tooling

- **Format**, **Smart format**, and **Compact** commands.
- **Sort** object keys or array items.
- **Transform** with four query languages: JSON Query, JMESPath, JSONPath, and JavaScript (Lodash-style).
- **Repair** for fixing broken JSON.
- **Undo/Redo** history that works across view switches.

### Validation with JSON Schema

- Validate a document against **no schema**, an **embedded schema**, or the **other panel's contents** used as the schema.
- Validation errors are reported inline in the status bar; schema `enum` fields render as dropdown selectors.

### CSV import & export

- Convert JSON documents to CSV and back, with configurable delimiter, header handling, and flattening of nested objects/arrays.
- Import accepts `.json`, `.jsonc`, `.txt`, `.har`, and `.csv` files — via the file picker or by dragging a file onto a panel.

### Document management

- Each panel keeps its own document, persisted across sessions. Creating, opening, or importing a file assigns a fresh document to the focused panel (up to 8 documents are stored in the workspace), with automatic naming ("New document N") and renaming via *Document properties*.
- **Autosave**: changes are persisted to host storage about a second after editing stops; `Ctrl+S` forces an immediate save. Unsaved changes are flagged with a *changed* indicator.
- **Save to disk** and **copy variants**: copy any document to the clipboard as formatted, smart-formatted, compacted, escaped (for pasting inside a string), or as-is.

## Requirements

- [DBX](https://github.com/t8y2/dbx) **0.5.68** or newer (Host API `1`).
- Node.js and npm (required for building the UI).

## Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/any-stories/dbx-plugin-json-editor.git
   cd dbx-plugin-json-editor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the UI (output goes to `ui/`):

   ```bash
   npm run build
   ```

4. Load the plugin from DBX's plugin management, or copy the plugin directory (containing `manifest.json`, `dbx-plugin.toml`, `assets/`, and `ui/`) into the DBX plugins folder.

During plugin development, DBX invokes the commands declared in `dbx-plugin.toml`: `npm run build` for a one-shot build and `npm run build:watch` for continuous rebuilds while the plugin is loaded.

> The UI can also be run standalone with `npm run dev`. When no DBX host is present, all host integrations (storage, clipboard, file transfer, theming) fall back to local in-browser defaults.

## Usage

- **Switch views** with the mode dropdown on each panel's toolbar (tree / table / text).
- **Compare two documents**: place them in the left and right panels, press **Compare**, and use the diff navigation buttons to step through differences. `Copy left` / `Copy right` transfers content between panels.
- **Open a document**: use the panel menu (*Open from disk*, *Import CSV*) or drag a file onto a panel. The first edit in an empty panel automatically creates a new document.
- **Save**: content is saved automatically; use `Ctrl+S` (or *Save now* in the panel menu) to persist immediately, or *Save to disk* to write a file.
- **Configure the editor**: open *Settings → Configure editor* to change the font size, indentation (spaces or tabs), escaping of control/unicode characters, table-view column flattening, and the JSON parser (Auto, Native, or Lossless).

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save now |
| `Ctrl+N` | New document in the focused panel |
| `Ctrl+Shift+F` | Format JSON |
| `Ctrl+Shift+M` | Minify JSON |
| `Ctrl+Shift+K` | Sort keys |
| `Esc` | Exit full screen / close dialogs |

Additional text-mode editor bindings: `Ctrl+F` (search), `Ctrl+I` (format), `Ctrl+J` (smart format), `Ctrl+Shift+I` (compact), and `Ctrl+Z` / `Ctrl+Shift+Z` (undo / redo).

## Permissions

The plugin's manifest declares the minimal permission set:

- `host.workbench` — provides the sandboxed workbench mount point and window title updates (`setTitle`).
- `host.storage` — workspace persistence: workspace metadata plus per-document content shards (`doc:<id>` keys), with a 200,000-character pre-check per value to stay within the host's 256 KiB storage limit.

All host access is funneled through a single adapter (`src/host/DBXAdapter.ts`), which talks only to the official Host API (`window.dbxPlugin`) and degrades to local defaults whenever a capability is unavailable.

## Development

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (standalone, with host fallbacks) |
| `npm run build` | Production build into `ui/` |
| `npm run build:watch` | Watch build used by DBX during plugin development |
| `npm run typecheck` | TypeScript strict type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint (flat config) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier formatting for `src/` |
| `npm run format:check` | Verify Prettier formatting |

### Tech stack

- React 19 + Vite 8 (Rolldown core) + TypeScript 5.9 (strict)
- `vanilla-jsoneditor` as the editor core (the vanilla entry of svelte-jsoneditor, adapted for React integration); text mode is powered by CodeMirror 6
- `lucide-react` icons, `diff-sequences` for array diffing, `lossless-json` for long-number-safe parsing
- ESLint (flat config + typescript-eslint + react-hooks), Prettier, EditorConfig

## Acknowledgements

This project uses the following open-source libraries:

- [React](https://github.com/facebook/react)
- [vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor)
- [lossless-json](https://github.com/josdejong/lossless-json)
- [diff-sequences](https://github.com/jestjs/jest)
- [Lucide](https://github.com/lucide-icons/lucide)
- [Liquid Glass](https://github.com/zakisheriff/Liquid-Glass)
- [Vite](https://github.com/vitejs/vite)
- [TypeScript](https://github.com/microsoft/TypeScript)
- [ESLint](https://github.com/eslint/eslint)
- [Prettier](https://github.com/prettier/prettier)
