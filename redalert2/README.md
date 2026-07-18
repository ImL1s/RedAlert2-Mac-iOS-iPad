# RA2WEB React

> **About this fork:** The goal of this fork is a full English translation of the project plus a native iOS (skirmish-focused) port, based on the upstream project.

## Disclaimer

This project is developed based on the analysis of the Chinese version of Chronodivide — RA2WEB (www.ra2web.com), and is intended to be refactored using the latest versions of React and Three.js. All rights to this project, including profit rights, belong to the owner of Chronodivide. Without permission from the owner of Chronodivide, any commercial use of this project is strictly prohibited.

It should be noted that the owner of Chronodivide has never open-sourced the game client code in any form, even though some peripheral open‑source content such as a mod‑SDK exists. Bugs, incomplete functions or other issues arising from the operation of this project shall not be regarded as damage to the reputation of Chronodivide. Any commercial activities conducted based on this project, including but not limited to placing advertisements, developing a "bullet-screen Red Alert" mode to profit from gifts, directly packaging and selling the project, or fraudulently obtaining sponsorship and donation revenue by claiming to be the "author", shall be deemed as infringement upon the original author of Chronodivide, Alexandru Ciucă, and RA2WEB.

![animation](https://github.com/user-attachments/assets/d83f6001-d426-4d49-98a6-8282addc898d)

![image](https://github.com/user-attachments/assets/f146dc1c-ca15-456a-a8f0-4b43f2d431e8)

![image](https://github.com/user-attachments/assets/a23760df-e679-4b32-a9a2-ca51c214c420)

![image](https://github.com/user-attachments/assets/4781f451-7a51-45e2-919b-cbcb8bbd727a)

## Project Overview

Red Alert 2 for the web — a complete TypeScript reimplementation of the classic real-time strategy game engine, built with React + TypeScript + Vite + Three.js. The engine is written entirely in TypeScript and aims for full parity with the original Red Alert 2 engine. After importing the original Red Alert 2 art assets locally, you get a gameplay experience close to the original game.

## Current Technical Status

### Runtime and Build

- Package manager and local runtime: `Bun 1.3.10`
- Dev server: `Vite 8.0.1`
- UI: `React 19.2.4` + `react-dom 19.2.4`
- Type system: `TypeScript 5.9.3`
- Rendering: `three 0.183.2`
- Automation: `Playwright 1.58.2`
- Default dev and preview address: `127.0.0.1:4000`

## Quick Start

### Requirements

- `Bun 1.3+`
- A modern browser; Chrome / Edge recommended
- The browser must support:
  - `WebGL`
  - `Web Audio API`
  - `File System Access API`

### Install and Run

```bash
cd redalert2
bun install
bun run dev
```

Default URL:

```text
http://127.0.0.1:4000
```

Production build and preview:

```bash
bun run build
bun run preview
```

Type checking:

```bash
bun run typecheck:entry
```

## Automated Regression

The repository no longer relies solely on manual click-through verification. `scripts/` maintains a set of directly executable regression scripts, mainly covering the lobby, entering a map, game mechanics, and the tester entry points.

Common commands include:

```bash
bun run debug:game-res-init
bun run debug:viewport
bun run debug:options
bun run debug:storage-explorer
bun run debug:skirmish
bun run debug:skirmish-lobby-data
bun run debug:victory-exit
bun run debug:superweapon
bun run debug:nuke
bun run debug:radiation
bun run debug:minimap-shroud
bun run debug:anti-air-hit
bun run debug:terror-drone
bun run debug:chrono-legionnaire
bun run debug:test-entries
bun run debug:tester-panels
```

The output of these scripts is written to `.artifacts/` by default, making it easy to review screenshots and JSON results.

## Tester Entry Points

The tester entries in the main menu currently fall into three categories:

1. Asset testers
   - `VXL Tester`
   - `SHP Tester`
   - `Audio Tester`
2. Mechanics testers
   - `Building Tester`
   - `Vehicle Tester`
   - `Infantry Tester`
   - `Aircraft Tester`
3. Scene testers
   - `Lobby Tester`
   - `World Tester`
   - `Movement Tester`

These tester pages are not isolated demos — they are important debugging and regression entry points for this repository. The left-side panel state of each page is synced to a debug state object, and the automation scripts use these entries directly to verify rendering and interaction results.

## Architecture

### Core Tech Stack

- `React 19.2.4`
- `TypeScript 5.9.3`
- `Vite 8.0.1`
- `three 0.183.2`
- `Bun 1.3.10`
- `Playwright 1.58.2`
- `7z-wasm`
- `file-system-access`
- `@ffmpeg/ffmpeg`
- `@ra2web/pcxfile`
- `@ra2web/wavefile`

### Directory Layout

```text
redalert2/
├── public/          Static assets, config, locales, legacy styles
├── scripts/         Playwright automated regression scripts
├── src/
│   ├── data/        Original asset formats, encodings, maps, VFS
│   ├── engine/      Rendering, audio, resource loading, low-level engine capabilities
│   ├── game/        Game logic, object system, triggers, rules, superweapons
│   ├── gui/         Main menu, HUD, options, in-game UI
│   ├── network/     Networking and multiplayer infrastructure
│   ├── tools/       Standalone tester pages
│   └── util/        Common utilities
├── docs/            Alignment notes and engineering documentation
└── vite.config.ts   Dev and build configuration
```

### Main Modules

`src/engine/`

- `gfx/`: three rendering layer, materials, batching, viewport, lighting
- `renderable/`: bridge layer from game objects to visual objects
- `sound/`: audio mixing, music, sound effect playback
- `gameRes/`: asset import, CDN loading, caching, and directory handling

`src/game/`

- `gameobject/`: units, buildings, projectiles, traits, locomotors
- `rules/`: INI rule parsing and object rule construction
- `trigger/`: map triggers, conditions, executors
- `superweapon/`: nuke, lightning storm, chronosphere, and other superweapon logic

`src/gui/`

- `screen/mainMenu/`: main menu, map selection, lobby, options
- `screen/game/`: in-game HUD, world interaction, menus
- `component/`: React components
- `jsx/`: custom UI rendering bridge

`src/tools/`

- Provides the asset, mechanics, and scene tester pages
- Currently an important entry point for debug visualization and automated assertions

## Development Commands

```bash
bun run dev
bun run build
bun run preview
bun run typecheck:entry
```

## Documentation and Debugging Conventions

- The dev port is fixed at `4000`
- The main technical alignment notes are maintained in `docs/build-alignment-log.md`
- Automation artifacts are written to `.artifacts/` by default
- A passing build does not mean all behavior is fully aligned; at the feature level, prefer the dedicated scripts and real gameplay flows for verification

## Contributing

Before submitting changes, at minimum run:

```bash
bun run typecheck:entry
bun run build
```

If your change touches the lobby, resource loading, entering a map, the HUD, game mechanics, or the testers, also run the corresponding `debug:*` scripts.

## License

This project is open-sourced under the GNU General Public License v3.0 (GPL-3.0). See the [LICENSE](LICENSE) file for details.

### Important Notes
- You are free to use, modify, and distribute this project, but commercial use is strictly prohibited unless permission is obtained from the owner of RA2WEB
- Copyright notices and the license text must be preserved
- Any derivative works must use the same GPL-3.0 license
- Source code, including modified versions, must be made available
- GPL code cannot be integrated into proprietary software

**Note:** This project is for learning and research purposes only. Red Alert 2 is the intellectual property of EA. Make sure you own a legal copy of the game before importing its art assets.

## Acknowledgements

- RA2WEB.COM
- The Three.js community
- The React team
- The TypeScript team
- Maintainers of the open-source dependencies used
- The Red Alert 2 player community

---

**Disclaimer:** This project is for learning and research purposes only and is not intended for commercial use. Red Alert 2 and related trademarks belong to EA.

---
