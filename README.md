# Command & Conquer Red Alert 2 — iPhone & iPad

**Red Alert 2 skirmish running natively on iPhone and iPad** — fully in English,
with touch controls built for RTS (tap-select, drag-box, two-finger map grab,
pinch zoom, long-press force-attack) and skirmish bots that build, expand,
scout, and attack — with a different personality every match.

No emulation, and no rewrite either: this is the real Chronodivide-lineage
TypeScript engine — the most complete faithful RA2 engine in existence —
kept battle-tested and unchanged where it counts, wrapped in a native Swift
shell. Rendering flows WebGL → ANGLE → Metal via WebKit; your retail game
assets ship inside the app bundle and never touch the network.

**No game assets are included or distributed.** You need your own copy of
Red Alert 2 ([Steam](https://store.steampowered.com/app/2229830/), part of the
C&C Ultimate Collection). A script imports assets from your install.

## Why this port is shaped differently than Generals

The sibling project ([Generals-Mac-iOS-iPad](https://github.com/ammaarreshi/Generals-Mac-iOS-iPad))
ports EA's GPL-released C++ engine: real engine, ARM64 compile, DXVK→MoltenVK
underneath. **RA2 has no released engine source.** EA's February 2025 source
drop covered Tiberian Dawn, Red Alert 1, Renegade, and Generals — RA2 is
conspicuously absent. There is nothing to compile.

What exists instead is a clean-room reconstruction: Chronodivide, reverse-built
over years into a deterministic TypeScript sim + Three.js renderer, continued
by the RA2WEB community. So the Generals playbook still applies — *preserve
the battle-tested engine, swap the platform underneath it* — but the
translation layer is different:

| Generals port | This port |
|---|---|
| Real 2003 C++ engine, untouched | Real Chronodivide-lineage TS engine, untouched where it counts |
| DX8 → DXVK → Vulkan → MoltenVK → Metal | WebGL → ANGLE → Metal (Apple ships this in WebKit, JIT included) |
| Filesystem rerouted into the bundle | Assets bundled + first-launch seed into origin storage, self-healing |
| SDL touch → RTS touch semantics | Custom gesture engine → the engine's pointer layer |
| "iOS owns your process" lifecycle work | Same, via the shell owning the WebView lifecycle |

## What the port actually involved

The engine ran in a desktop browser on day one. Everything between that and
"plays great on an iPad" was the actual work:

- **English, all the way down.** The fork was Chinese. In-game strings turned
  out to be 99.98% recoverable from the retail English `ra2.csf` (one key was a
  translator credit); ~38 source files of UI/comments/dev-tools were translated
  by hand.
- **A native shell with zero network dependency.** Custom URL-scheme handler
  serving the built app and 376MB of game assets from the bundle; first-launch
  seeding into browser origin storage that verifies per-file and self-heals
  when iOS purges storage under disk pressure.
- **Touch controls that feel like an RTS**, not a webpage: one-finger
  tap/drag-box, two-finger 1:1 map grab, pinch zoom (which meant *unlocking
  camera zoom in the engine* and making pan limits zoom-aware), long-press
  force-attack, and cancelled touches that never ghost-click — the Generals
  lesson, relearned in a new engine.
- **Display tuning for phones and tablets**: context-aware logical resolution
  (menus need their 800×600 bitmap design; in-game HUD reads better at ~0.84
  scale on a phone and 1.42× on an iPad mini), which surfaced a "the engine
  never upscales" assumption and an input-mapping race when scale changes.
- **Bug archaeology with fixes the web version needs too**: unit voice
  acknowledgments silenced by a numeric-enum-vs-string switch, a build-queue
  oscillation that had prevented the skirmish bot from ever constructing more
  than one building on any platform, texture-atlas bleed dotting the fog of
  war at fractional zoom, sub-pixel camera pan tearing the shroud.
- **Bots worth fighting.** The built-in AI (a port of the Supalosa Chronodivide
  bot) got a difficulty ladder (Easy / Normal / Brutal — pacing, not cheating)
  crossed with per-match personalities (rusher / balanced / boomer / sieger),
  rolled deterministically so future LAN play stays in lockstep.

**→ The complete engineering log: [docs/PORTING_PLAYBOOK.md](docs/PORTING_PLAYBOOK.md)**

Like the Generals port, this is a **human + AI collaboration**: the
engineering was done by [Claude Code](https://claude.com/claude-code)
(Anthropic's Claude, Fable model), directed and playtested by a human who
described symptoms like *"tapping the MCV won't detect the touch"* and *"the
easy opponent doesn't seem to be doing much"* and owned every decision.

## Quick start

Prerequisites (one time):

```sh
xcode-select --install                  # plus full Xcode for device builds
brew install xcodegen ffmpeg
curl -fsSL https://bun.sh/install | bash
```

Clone, import your assets, build:

```sh
git clone <this-repo> ra2-ios && cd ra2-ios
(cd redalert2 && bun install)

# Import game resources from your own RA2 install (Steam path shown):
RA2_RETAIL_DIR="$HOME/Library/Application Support/Steam/steamapps/common/..." \
    bun scripts/prepare-gameres.ts

./scripts/build-ios.sh                  # build + iPhone simulator
RA2_TEAM_ID=<your-team-id> ./scripts/build-ios.sh --device   # iPhone/iPad
```

Find your team id in Xcode → Settings → Accounts. Install the device build
with `xcrun devicectl device install app --device <id> <path to RA2.app>`.

Desktop development (no Xcode needed):

```sh
cd redalert2 && RA2_HTTP=1 bun run dev
# open http://localhost:4000/?shell=1  ← exercises the exact iOS boot path
```

## Where things are

| Path | What it is |
|---|---|
| [`docs/PORTING_PLAYBOOK.md`](docs/PORTING_PLAYBOOK.md) | Engineering log: every failure mode, root cause, fix — including the bot that couldn't build and the fog full of dots |
| `redalert2/` | The engine (Bun + Vite + React + Three.js). Base: [huangkaoya/redalert2](https://github.com/huangkaoya/redalert2) @ `8c07f10` |
| `redalert2/src/shell/` | Shell integration: first-launch asset seeding, shell detection, debug log pipe |
| `redalert2/src/game/ai/thirdpartbot/builtIn/` | The skirmish bot (Supalosa-derived) + difficulty profiles + personalities |
| `ios/` | XcodeGen project: Swift shell, WKWebView, bundle scheme handler |
| `scripts/prepare-gameres.ts` | Builds the asset tree + English strings from your retail install |
| `scripts/build-ios.sh` | Web build → asset staging → xcodegen → xcodebuild |

## Lineage & credits

This project stands on a chain of remarkable work:

- **[Chronodivide](https://chronodivide.com)** by **Alexandru Ciucă** — the
  clean-room RA2 engine reconstruction this all descends from. Never
  open-sourced by its author; see disclaimer below.
- **[RA2WEB](https://www.ra2web.com)** — the Chinese community continuation.
- **[huangkaoya/redalert2](https://github.com/huangkaoya/redalert2)** — the
  React/Three.js refactor this repo builds on.
- **[Supalosa's Chronodivide bot](https://github.com/Supalosa/supalosa-chronodivide-bot)**
  — the foundation of the skirmish AI.
- **Westwood Studios** — for the game. © 2000 Electronic Arts Inc.

## Disclaimer

This is a non-profit fan project, not affiliated with Electronic Arts Inc.
No copyright infringement is intended; all rights are held by their respective
owners. Per the upstream project's terms: all rights, including profit rights,
to the underlying engine reconstruction belong to the owner of
Chronodivide/RA2WEB, and **any commercial use is strictly prohibited**. No
game assets are distributed with this repository; a legally-owned copy of
Red Alert 2 is required.
