# Command & Conquer Red Alert 2 + Yuri's Revenge — iPhone & iPad

**Red Alert 2 and Yuri's Revenge skirmish running natively on iPhone and
iPad** — fully in English, with touch controls built for RTS (tap-select,
drag-box, two-finger map grab, pinch zoom, long-press force-attack),
mid-match save/load, retail-accurate lighting, and skirmish AI rebuilt from
the ground up until no two matches play the same: per-match personalities ×
strategic doctrines, the retail game's own 146 attack teams, superweapons
fired like the original AI fired them, spies, garrisons, terror drones, and
a different opponent every time you press Start.

No emulation, and no rewrite either: this is the real Chronodivide-lineage
TypeScript engine — the most complete faithful RA2 engine in existence —
kept battle-tested and unchanged where it counts, wrapped in a native Swift
shell. Rendering flows WebGL → ANGLE → Metal via WebKit; your retail game
assets ship inside the app bundle and never touch the network.

**No game assets are included or distributed.** You need your own copy of
Red Alert 2 + Yuri's Revenge ([Steam](https://store.steampowered.com/app/2229830/),
part of the C&C Ultimate Collection). One script imports everything from
your install:

```sh
./scripts/setup.sh /path/to/your/ra2/install
```

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

And where the Generals engine came with its AI, its lighting, and its
expansion content built in, here each of those became its own campaign —
which is where most of the story below happened.

## The story of the effort

The engine ran in a desktop browser on day one. Everything between that and
"a full RA2+YR experience that plays great on an iPad" was the actual work.
In rough chronological order:

### Making it a product
- **English, all the way down.** The fork was Chinese. In-game strings turned
  out to be 99.98% recoverable from the retail English `ra2.csf` (one key was
  a translator credit); ~38 source files of UI/comments/dev-tools were
  translated by hand.
- **A native shell with zero network dependency.** Custom URL-scheme handler
  serving the built app and ~750MB of game assets from the bundle;
  first-launch seeding into browser origin storage that verifies per-file and
  self-heals when iOS purges storage under disk pressure.
- **Touch controls that feel like an RTS**, not a webpage: one-finger
  tap/drag-box, two-finger 1:1 map grab, pinch zoom (which meant *unlocking
  camera zoom in the engine* and making pan limits zoom-aware), long-press
  force-attack, and cancelled touches that never ghost-click.
- **Native-resolution rendering** (logical UI scale × devicePixelRatio into
  the WebGL backing store) so an iPad mini renders the battlefield at
  2560×1440 instead of an upscaled 1280×720 — which surfaced input-mapping
  and shroud-seam bugs that only exist at fractional scales.
- **Mid-match save/load**, built on the engine's replay system: a save is the
  action log up to the saved tick; loading resimulates it deterministically
  at maximum speed and hands control back. This forced a real determinism
  audit (an RNG seed was silently losing millisecond precision in a
  round-trip through the save format).

### Making it Yuri's Revenge
The engine had YR scaffolding but booted RA2-only. Getting to a **fully
playable third faction** took three phases: engine-mode plumbing and md-asset
import; the slave-miner economy (the faction's core loop — slaves, grinder,
bio reactor occupancy power); and the exotics — Mastermind mind-control
capacity, Magnetron vehicle lifting, Tank Bunkers, Cloning Vats, Psychic
Dominator and Genetic Mutator superweapons, Battle Fortress open-topped
fire, Robot Tanks with a live control-center dependency, Boris airstrikes,
berserk gas. Plus the YR-specific crash archaeology: the retail `rulesmd.ini`
*omits* ~25 `[AudioVisual]` keys that the YR binary hardcodes — the first
move order in any YR game was a fatal crash until the engine learned the
retail defaults.

### Making it look right
A 26-agent audit compared every asset and lighting path against retail
byte-for-byte: seeded archives identical to Steam, VXL parsing byte-equal to
the CNCMaps reference, all four voxel normal tables exact. The audit also
found real divergences, all fixed: map `[Lighting]` ground term applied with
the wrong sign, palette lighting multiplied in the wrong color domain (now
exact gamma-domain math in the shaders), voxel shading rebuilt to the retail
`palette × (0.8 + 1.3·dotNL) × cell light` model, invisible lamp buildings
that should cast light without rendering (the source of YR's famous
white-washed city blocks), and per-country loading-screen palettes (YR
repainted every one; the engine was using the RA2 palette — hence the
"16-bit-looking" load screens).

### Making the AI worth playing
The centerpiece, and the longest fight in the project. The stock bot idled
behind three war factories, rushed the same conscripts every game, and once
built twenty bio reactors. Five research-driven passes built the systems —
and then a sixth pass discovered that several of them had never actually
been running:

1. **Diagnosis + the retail database.** The root causes were structural (army
   units were only ever built when an attack mission requested them). The fix
   came with a gift: the retail `aimd.ini` — 132 TaskForces, 165
   AITriggerTypes — parsed and wired in as the attack-team library, with
   conditions ("enemy owns ≥1 battle lab"), per-difficulty enables, and
   outcome-weight feedback. Even the upstream bot project had this on its
   wishlist.
2. **Superweapons + squad brains.** A superweapon officer that fires nukes,
   storms and dominators at the enemy's most valuable cluster, iron-curtains
   its own armored push, chronoshifts vehicle squads, answers *your* launches
   with Force Shield at retail's 90/50/10% by difficulty, and paradrops into
   ongoing fights. Squads learned to retreat from lost fights (distilled from
   OpenRA's attack-or-flee fuzzy logic), artillery holds stand-off range,
   attacks arc in on center/flank/backdoor lanes.
3. **No two skirmishes the same.** Per-match rolls: 6 personalities × 5
   doctrines × an opening book × ±40% production-weight jitter × a mask that
   benches a quarter of the attack-team deck each game. Country identity
   (Iraq fields Desolators, Cuba terrorists, France Grand Cannons, Korea
   Black Eagles). ~20 missing units and 6 missing buildings entered the
   roster with micro-roles so specialists fight correctly — terror drones
   hunt vehicles, commandos C4 buildings, demo trucks trade themselves for
   structures. A counter-composition census answers what *you* build.
4. **EA's own source code.** With RA1's `HOUSE.CPP` Expert AI and Generals'
   skirmish AI open-sourced, the actual retail values replaced guesses:
   trigger feedback at true retail strength (+20/−50 with the track-record
   snowball), superweapon targeting from the real `AIIonCannon` value tables,
   fire-on-ready timing, per-difficulty defense caps (easy AIs are nearly
   undefended — that's what makes them beatable), the ±80% census misjudgment
   that makes easy bots build wrong counters, grudge-based enemy focus, and
   RA1's iconic fire-sale endgame.
5. **Backporting the learnings.** OpenRA-style leader movement (the slowest
   unit leads; pushes arrive as one fist), air discipline (flyers refuse
   AA-saturated zones; air production pivots when you wall the sky), spy
   infiltration (battle lab = stolen-tech units), Battle Fortress boarding,
   and the RA1 desperation sell-ladder.

6. **Finding out none of it was on.** A 19-agent review fixed 14 real bugs
   and made the sim 2.2× faster — and the AI still played badly on device.
   The reason is the most useful thing this project learned: **a bot that
   does nothing throws nothing.** Error-free soak tests and per-tick
   profiling both passed while large parts of the AI were inert. Three
   defects were switching it off. A lobby validator written before "Brutal"
   existed silently demoted every saved Brutal slot to Easy. A mission gate
   nested a global `tick % 3` inside a per-bot phase-offset update —
   arithmetic that, for most bots, is *never simultaneously true*, so they
   ran no missions, no attacks and no superweapons for entire matches. And a
   "failsafe" meant to unstick a dead bot queued buildings behind the real
   queue controller's back, falling through to "extra power is always
   useful" — forever. That single line is the true origin of the twenty bio
   reactors, and its queue/cancel war with the real controller burned the
   economy that should have been buying tanks.

Then a 198-agent adversarial audit went looking for the rest, and confirmed
72 findings across eleven dimensions. The pattern repeated: the same dead-gate
arithmetic had also silenced the threat model for seven bots in eight (so
defenses stopped at one of each type and nobody expanded); attack squads
disbanded on their *first* update because a no-target timer started at zero;
tech and superweapons scaled their desire by *current cash* while a healthy
bot spends to zero, so those requests never formed; the war factory kept
buying harvesters because miners outweighed tanks in the background pool;
artillery was missing from that pool entirely; and bot reaction speed was
derived from the wall clock against the game-speed slider, making every
difficulty six times more sluggish per tick at the iPad's default speed than
in the lab. Retail's hidden AI economy bonus (`AIVirtualPurifiers` — brutal
refines ore at +100%) was simply never wired.

The fix that matters most isn't in that list: **liveness is now asserted, not
assumed.** `scripts/ai-liveness-probe.js` runs a mixed-difficulty match
headlessly and fails the build if any bot stops thinking, stops forming
attack waves, never projects force away from home, spams one structure, or
accumulates queue cancels — and the iOS build script refuses `--device`
without that sign-off. Alongside it is a habit rather than a tool: watch the
game. Reveal the map, pan the camera onto each bot's base, screenshot it
minute by minute, and judge it the way a player does. Every remaining issue
in this list was found that way, not by a counter.

### Making it cool (thermally)
Frame-rate caps with the sim decoupled (60/30/uncapped graphics option,
menus hard-capped at 30fps), no framebuffer preservation, scene-graph matrix
auto-update disabled in favor of explicit updates, octree re-slotting only on
tile changes — the earlier performance pass that took total frame CPU to
~3.6ms, which the AI work then had to respect (and did — see the numbers
above).

**→ The complete engineering log: [docs/PORTING_PLAYBOOK.md](docs/PORTING_PLAYBOOK.md)**

Like the Generals port, this is a **human + AI collaboration**: the
engineering was done by [Claude Code](https://claude.com/claude-code)
(Anthropic's Claude, Fable model), directed and playtested by a human who
described symptoms like *"tapping the MCV won't detect the touch"* and *"one
of the Yuri AIs just made like 20 bio reactors"* and owned every decision.

## Quick start

Prerequisites (one time):

```sh
xcode-select --install                  # plus full Xcode for device builds
brew install xcodegen ffmpeg
curl -fsSL https://bun.sh/install | bash
```

Clone and run the setup script against your own install:

```sh
git clone <this-repo> ra2-ios && cd ra2-ios
./scripts/setup.sh "/path/to/steamapps/common/Command & Conquer Red Alert 2"
```

The script installs dependencies, verifies your retail files, imports and
converts the assets (nothing is downloaded — everything comes from your
copy), and tells you what to run next:

```sh
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
| [`docs/PORTING_PLAYBOOK.md`](docs/PORTING_PLAYBOOK.md) | Engineering log: every failure mode, root cause, fix |
| `redalert2/` | The engine (Bun + Vite + React + Three.js). Base: [huangkaoya/redalert2](https://github.com/huangkaoya/redalert2) @ `8c07f10` |
| `redalert2/src/shell/` | Shell integration: first-launch asset seeding, shell detection, debug log pipe |
| `redalert2/src/game/ai/thirdpartbot/builtIn/` | The skirmish AI: personalities, doctrines, retail trigger DB, superweapon officer, squad micro |
| `redalert2/src/game/ai/.../ai-ini/aiTriggerDb.ts` | Parser/evaluator for the retail `aimd.ini` attack-team database |
| `redalert2/src/game/ai/.../logic/superweapons.ts` | The superweapon officer (targeting, timing, anti-SW Force Shield) |
| `redalert2/src/gui/screen/mainMenu/loadGame/` | Mid-match save/load (replay-backed) |
| `ios/` | XcodeGen project: Swift shell, WKWebView, bundle scheme handler |
| `scripts/setup.sh` | One-shot setup: deps + retail import + next steps |
| `scripts/prepare-gameres.ts` | The asset importer (what `setup.sh` runs for you) |
| `scripts/build-ios.sh` | Web build → asset staging → xcodegen → xcodebuild |

## Lineage & credits

This project stands on a chain of remarkable work, and this time we want to
name all of it:

**The engine lineage**
- **[Chronodivide](https://chronodivide.com)** by **Alexandru Ciucă** — the
  clean-room RA2 engine reconstruction this all descends from: a
  deterministic, faithful RA2 simulation built in TypeScript over many
  years. Never open-sourced by its author; see the disclaimer below.
- **[RA2WEB](https://www.ra2web.com)** and the Chinese RA2WEB community —
  the continuation that kept the engine alive and growing.
- **[huangkaoya/redalert2](https://github.com/huangkaoya/redalert2)** — the
  React + Three.js refactor this repo builds on directly.

**The AI's teachers**
- **[Supalosa's Chronodivide bot](https://github.com/Supalosa/supalosa-chronodivide-bot)**
  (MIT) — the foundation of the skirmish AI: missions, squads, threat maps,
  and the scaffolding everything else was built into. Several fixes from its
  newer branches (force-attack on disguised units, ammo gating, action
  cooldowns) were ported back in.
- **[OpenRA](https://github.com/OpenRA/OpenRA)** (GPL-3.0) — the squad-state
  designs our combat micro learned from: the attack-or-flee evaluation,
  leader-based squad movement, and the air-squad AA-safety rule. Algorithms
  were studied and re-implemented for this engine, not copied.
- **EA's official open-source releases** —
  [CnC_Red_Alert](https://github.com/electronicarts/CnC_Red_Alert) (the
  Expert AI in `HOUSE.CPP`: urgency systems, superweapon handling, the
  fire-sale) and
  [CnC_Generals_Zero_Hour](https://github.com/electronicarts/CnC_Generals_Zero_Hour)
  (skirmish AI pacing and superweapon coordination). Releasing these was a
  gift to the community; this project mined them gratefully.
- **The retail `aimd.ini`** — Westwood's own AI designers authored the 132
  attack teams and 165 triggers our bots now field. The best AI content in
  the game was in the game all along.

**The reference keepers**
- **[ModEnc](https://modenc.renegadeprojects.com)** — the C&C modding
  encyclopedia; the semantics of every ini key, script action, and AI knob
  used here were verified against it.
- **[CNCMaps / ccmaps-net](https://github.com/zzattack/ccmaps-net)** by
  **zzattack** — the rendering reference used to verify VXL parsing and
  reconstruct retail lighting math (`Palette.ApplyLighting`).
- **[Project Perfect Mod](https://www.ppmsite.com)** and **DeeZire's RA2/YR
  INI Editing Guide** — decades of community documentation on how this game
  actually works.
- **[CnCNet](https://cncnet.org)** and the wider C&C community — for keeping
  these games alive for 25 years.

**The tools**
- [Three.js](https://threejs.org), [React](https://react.dev),
  [Vite](https://vitejs.dev), [Bun](https://bun.sh),
  [@timohausmann/quadtree-ts](https://github.com/timohausmann/quadtree-ts),
  [js-logger](https://github.com/jonnyreeves/js-logger), and
  [7-Zip](https://www.7-zip.org) (the WASM build powers in-browser archive
  import).
- [Claude Code](https://claude.com/claude-code) — the AI pair that did the
  engineering.

**The originators**
- **Westwood Studios** — for Red Alert 2 and Yuri's Revenge, still the high
  point of the genre. © 2000–2001 Electronic Arts Inc. Command & Conquer,
  Red Alert, and Yuri's Revenge are trademarks of Electronic Arts Inc.

If we've still missed anyone whose work this builds on, please open an
issue — credit will be added, gladly.

## Disclaimer

This is a non-profit fan project, not affiliated with Electronic Arts Inc.
No copyright infringement is intended; all rights are held by their
respective owners. Per the upstream project's terms: all rights, including
profit rights, to the underlying engine reconstruction belong to the owner
of Chronodivide/RA2WEB, and **any commercial use is strictly prohibited**.

No retail game assets are distributed with this repository; a legally-owned
copy of Red Alert 2 + Yuri's Revenge is required, and the import script
only ever reads from *your* install. The repository inherits from its
upstream base a small bootstrap configuration bundle (`redalert2/public/`)
that the engine needs to reach its menus; if you are a rights holder and
would like anything here changed or removed, open an issue and it will be
handled immediately.
