# Progress Dock

Progress Dock is a local-first Obsidian dashboard for numeric goals, deadlines, countdowns, and branching learning roadmaps. It opens as a dockable Obsidian side panel and stores all data in the plugin's own `data.json`.

Repository: https://github.com/ririririse/obsidian-progress-dock

## Features

- Create numeric tasks with current value, target, unit, and bar/ring/number display modes.
- Drag a progress slider or click the current and target values to enter exact custom numbers; the percentage updates automatically.
- Add DDL dates with categories, notes, colors, month calendar, and countdown view.
- Event dates use highlighted cells, larger color markers, and count badges for visibility.
- Hover or keyboard-focus the overall **Recent DDL** heading to preview all DDL items in one calendar.
- Create sequential and parallel learning paths.
- Mark every learning node complete independently.
- Works with Obsidian light and dark themes.
- No account, network request, telemetry, or modification of note files.

## Branching roadmap syntax

- `->` or `→` starts the next stage.
- `+` or `|` creates parallel branches in the same stage.

Example:

```text
HTML / CSS -> JavaScript -> React + Vue -> Project practice
```

React and Vue appear as parallel branches. Both can be marked complete separately.

## Manual installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into:
   `<Vault>/.obsidian/plugins/progress-dock/`
2. Reload Obsidian.
3. Open **Settings → Community plugins** and enable **Progress Dock**.
4. Select the gauge icon in the left ribbon or run **Open Progress Dock** from the command palette.

The ready-to-copy files are also available in the `release` folder after running `pnpm run build`.

## Build

```bash
pnpm install
pnpm run build
```

## Releases

Release tags match the version in `manifest.json`. Every release provides `main.js`, `manifest.json`, and `styles.css` as downloadable assets for Obsidian.

## Privacy

Progress Dock has no network access and does not read or change Markdown notes. Plugin data is stored by Obsidian in `.obsidian/plugins/progress-dock/data.json`.

## License

MIT
