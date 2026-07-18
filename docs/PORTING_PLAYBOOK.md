# Porting Playbook — Red Alert 2 to iPhone & iPad

The complete engineering log of bringing the Chronodivide-lineage RA2 engine to
iOS: the architecture, the decisions, and every bug hunt worth remembering. Read
the [README](../README.md) first for the shape of the project.

---

## 1. The premise: no engine to compile

The Generals port compiles EA's GPL C++ engine for ARM64. That option does not
exist for RA2 — EA's Feb 2025 C&C source release pointedly excluded it. What we
have is a *reconstruction*: Chronodivide, a deterministic TypeScript sim plus a
Three.js renderer, reverse-engineered to match RA2's `rules.ini` semantics, unit
locomotors, warheads, isometric pathfinding, and lockstep determinism.

That flips the port strategy. The engine's native platform is already the web —
JS + WebGL. iOS ships an excellent web platform (WebKit, with WebGL→ANGLE→Metal
and JIT inside the app). So instead of translating a graphics API, the job is:

1. Wrap the web engine in a real native app.
2. Get the retail assets onto the device without a server.
3. Replace mouse/keyboard with touch that feels native to an RTS.
4. Fix everything that only breaks once a human is holding it.

Nothing about the sim or renderer is rewritten. That's the whole point — the
value is in the years of reconstruction, and the risk of a rewrite is
re-inheriting every subtle sim bug that was already found and fixed.

## 2. The native shell

`ios/` is an XcodeGen project (same tooling as the Generals port) producing a
single-view Swift app whose root is a `WKWebView`.

**Serving the app offline.** A `WKURLSchemeHandler` (`BundleSchemeHandler.swift`)
answers a custom `ra2app://` scheme:

- `ra2app://app/…` → the built web app (`Resources/WebDist`)
- `ra2app://app/gameres/…` → the imported game assets (`Resources/GameRes`)

Everything is memory-mapped from the code-signed bundle. No network, no
localhost server, no CORS. The web app never learns it isn't on a real origin.

**Lifecycle & feel.** Landscape-locked. Idle timer disabled (an RTS session
shouldn't dim mid-battle). `AVAudioSession` set to `.playback` so game audio
ignores the silent switch. `mediaTypesRequiringUserActionForPlayback = []` so
audio and the menu video can autoplay. The WebView is marked `isInspectable` in
debug builds so Safari's Web Inspector can attach to a running device.

## 3. Getting 376MB of assets onto the device

The engine normally imports assets in-browser: the user points it at their game
files, and it splits/transcodes MIX archives into origin-private storage (OPFS).
On iOS we don't want the user hunting for files, so assets are prepared ahead of
time and bundled.

**Build-time** (`scripts/prepare-gameres.ts`): an offline re-implementation of
the importer. It reads your retail MIXes directly, copies the core archives,
transcodes the music (`theme.mix` WAV → MP3 via ffmpeg), converts the menu video
(`ra2ts_l.bik` → WebM), extracts the English string table (`ra2.csf` out of
`language.mix`), and renders the loading splash (`glsl.shp` + `gls.pal` inside
`ra2.mix` → PNG, with a from-scratch PNG encoder so the script needs no browser).

**First launch** (`src/shell/iosSeed.ts`): copies the bundled tree into OPFS,
then flips the engine's "resources imported" flag so it boots straight to the
menu. This is deliberately **not** gated on a stored boolean — iOS can evict
OPFS under disk pressure while `localStorage` survives (or vice versa). The
seeder verifies each file's size against a manifest and re-copies only what's
missing or stale. Result: if the OS ever guts the storage, the next launch
silently repairs it instead of showing a broken game.

`?shell=1` forces shell mode in a desktop browser, and a Vite middleware serves
`/gameres/` from the exported tree — so the entire iOS boot path (seed included)
is testable on a laptop.

## 4. Touch controls — the Generals lessons, in a new engine

The upstream engine had a placeholder mobile scheme: an on-screen "L / R" toggle
you tapped to choose which mouse button your next tap sent. Functional, not fun.
It was replaced with a real gesture engine in the engine's own pointer layer
(`src/gui/PointerEvents.ts`), mapping touches to the mouse semantics the sim
already understands:

| Gesture | Meaning |
|---|---|
| One-finger tap | Left click (select / issue order) |
| One-finger drag | Selection box |
| Two-finger drag | Right-drag "map grab" — content tracks the fingers 1:1 |
| Pinch | Camera zoom |
| Two-finger tap | Right click (deselect) |
| Long-press | Force-attack (ctrl-click) |

Two hard-won details carried straight over from the Generals port:

- **Cancelled touches must never ghost-click.** Open the app switcher mid-drag
  and iOS fires `touchcancel`. The gesture engine synthesizes a `mouseup`
  flagged `cancelled`, and the world-interaction layer uses that flag to release
  all held state (selection box, pan) *without* executing the click. A cancelled
  rally-point drag doesn't order your army into the sea.
- **A two-finger gesture that starts as one finger** must retract the left-mouse
  press it already sent (again, a cancelled `mouseup`) before beginning the pan,
  or the first frame of every map-grab also box-selects.

**Pinch zoom forced real engine work.** Camera zoom was hard-locked to 1.0
outside a dev flag. Enabling it meant: a `CameraZoom` that clamps between
"viewport exactly fits the map" and 2×; **zoom-invariant panning**
(`WorldScene.updateCamera` no longer divided pan by `camera.zoom`, and pan
limits are recomputed each zoom as `viewport / zoom`); and dividing the finger
delta by zoom in the pan handler so the map tracks the fingers at any zoom. A
bonus: mouse-wheel zoom now works on desktop too.

## 5. Display scaling for phones and tablets

The engine renders to a fixed logical resolution and scales the result to the
screen. Two findings:

- **Menus vs. game want different logical sizes.** The menu art is designed for
  an 800×600 canvas and looks wrong scaled below it; the in-game HUD is happy
  smaller, where a smaller logical size means a *bigger* on-screen HUD. So the
  logical resolution is context-aware: 800×600 in menus, 800×480 in-game
  (`inGameViewportActive` flips on `GameScreen`/`ReplayScreen` enter/leave).
- **The engine never upscaled.** Display scale was capped at 1.0 — fine on a
  phone whose screen is smaller than the logical canvas, but on an iPad (logical
  canvas *smaller* than the screen) it rendered pixel-for-pixel in the middle
  with wasted margins and clipped edges. Mobile layouts now aspect-fill from the
  design base and scale past 1.0 (iPad mini: menus 1.24×, in-game 1.42×).

See §8 for the input bug this scaling exposed.

## 6. English translation

Two layers of Chinese. The in-game strings live in a CSF (compiled string file);
the retail English `ra2.csf` — pulled from your own `language.mix` — covers
4,476 of 4,477 keys (the lone miss was a translator credit), so it simply
*replaces* the fork's `general.csf`. The app-chrome strings live in a JSON locale
file (6 keys added). The remaining ~38 source files (dev tools, GUI screens, LAN
pairing, README) were translated by hand, leaving load-bearing literals intact
(e.g. `CsfFile` detects Chinese game-data by comparing a theme label to `开场` —
a data comparison, not display text).

One bug fell out of this: the download-progress string is a CSF template with a
`%d`, but the importer passed a pre-formatted `"12.3 MB"` string. `sprintf`
threw, which aborted the import with a misleading "download failed." Wrapped in a
try/catch that degrades gracefully.

## 7. The skirmish AI

The built-in bot is a port of the [Supalosa Chronodivide
bot](https://github.com/Supalosa/supalosa-chronodivide-bot) — base building,
economy, threat maps, and scouting/expansion/attack/defence/retreat missions.

**Difficulty ladder** (`botProfiles.ts`). Three profiles — Easy / Normal /
Brutal — that shape *pacing, not resources*: APM cap (reaction speed), attack
army-size multiplier, attack-cooldown multiplier, and a first-attack grace
period. No cheating. Easy reacts slowly, sends small waves, and leaves you six
minutes to breathe; Brutal is 600 APM with larger armies and half the cooldown.

**Per-match personality.** On top of difficulty, each game rolls one of four
personalities — rusher, balanced, boomer, sieger — that further scale pacing and,
crucially, *weight the unit compositions* (a rusher favours cheap infantry
spam; a boomer stacks Apocalypse tanks and Kirovs; a sieger builds artillery
pushes). The roll uses the game's own deterministic PRNG, never `Math.random`,
so bots stay in lockstep for future LAN play. Same difficulty setting produces a
different opponent every match.

## 8. Bug archaeology

The best part. Each of these was found by playing on a real device.

### The bot that could never build (all platforms)

**Symptom:** *"the easy opponent doesn't seem to be doing much"* — the AI
deployed its MCV, built exactly one power plant, then sat there. Credits frozen
at 9,128 for 8,000+ ticks.

**Root cause:** RA2 structure queues hold one item at a time. The bot's building
mission was stateless — every tick it recomputed "what's the best structure to
build?" from the full available list. While the power plant was under
construction, "best available" evaluated to the *barracks*. The queue controller
saw an in-progress item that was no longer being requested, treated its priority
as zero, and dequeued it to start the barracks — at which point "best available"
flipped back to the power plant. An infinite queue → cancel → re-queue
oscillation. **Every difficulty, on desktop too, had never built past its first
structure.**

**Fix:** two changes. The building mission now commits to whatever is in
production until it's placed (re-emitting the same choice with its location). And
the queue controller refuses to preempt an in-progress building that has merely
lost its request for a tick. Verified live: full build order
(ConYard→power→barracks→refinery→war-factory×2→radar), harvesting, scouting, and
an attack launched around the 8-minute mark.

### Silent unit voices

**Symptom:** ordering a unit produced no "Yes sir / Moving out" acknowledgment.

**Root cause:** `SoundHandler.handleOrderPushed` switched on the strings
`'Move'` / `'Attack'` / `'Capture'`, but the order pipeline hands it a *numeric*
`OrderFeedbackType` enum. A number never equals a string; every case fell
through. Silent on every platform.

**Fix:** switch on the enum, and while there, wire up the `Enter` and
`SpecialAttack` feedback the string version never even covered. Another one the
web build wants.

### A fog of war full of dots

**Symptom:** *"if I zoom into certain levels I see the dots in the fog."*

**Root cause:** the SHP texture atlas packed sprite images edge-to-edge with zero
padding. Terrain and shroud tiles sample with nearest-neighbor filtering, and at
a *fractional* zoom the sampler reads a texel just past a tile's edge — landing
in the neighbouring atlas entry, often a transparent or wrong-coloured pixel, so
stray dots punch through the fog.

**Fix:** pack every image with a 1px gutter filled by extruding its own edge
pixels (the standard atlas-bleed fix). UVs still reference the exact image rect,
so nothing else changes — and terrain/unit seams at fractional zoom are gone too.

### A shroud that tore while scrolling

**Symptom:** *"when scrolling and panning these lines appear sometimes depending
on the frame, but if left in the right place they go away."*

**Root cause:** the two-finger pan tracks the centroid of both fingers, which
lands on half-pixels, and zoomed panning divides by the zoom factor — either way
the camera ends up at a sub-pixel position, and the shroud tiles bleed at their
seams. "Go away when left in the right place" = lands back on a whole pixel.

**Fix:** snap the applied pan to whole canvas pixels each frame
(`round(pan * zoom) / zoom`).

### Taps that missed after scaling up

**Symptom:** *"I'm tapping the MCV but it won't detect the touch... the bottom
bar seems to be working."*

**Root cause:** entering a game changes the UI scale (menus 1.24×, in-game 1.42×
on iPad). The input layer re-measures the canvas rect at that moment to build its
touch→canvas mapping — but the re-measure fired *before* the new scale was
applied to the DOM, capturing the old transform against the new canvas size.
Every world tap then went through a ~13% wrong scale, an error that grows with
distance from screen center. The bottom command bar kept working because its
buttons sit near the transform origin (tiny error) and have large hit areas.

**Fix:** apply the layout (size + scale transform) *before* announcing the
viewport change, so subscribers measure reality. This bug had been latent since
the first iPhone build — it only became felt-able once a build actually upscaled.

### The blank-screen boot hang

**Symptom:** a build shipped, then *"right now I see a blank screen."*

**Root cause:** an over-eager audio fix. To skip the audio-permission dialog in
the shell, the boot path `await`ed `AudioContext.resume()`. WebKit leaves that
promise *pending forever* until a user gesture arrives — the very gesture the
dialog used to provide. Boot blocked on audio and never drew the menu.

**Fix:** never await audio on the boot path. Kick off the resume fire-and-forget
and retry on the first touch. Worst case audio starts a beat late; the game
always boots.

---

## Appendix: reproducing an asset build

```sh
RA2_RETAIL_DIR=/path/to/your/ra2/install bun scripts/prepare-gameres.ts
./scripts/build-ios.sh --device        # needs RA2_TEAM_ID for signing
```

`prepare-gameres.ts` is the source of truth for what the app ships and how it's
derived from retail files. Nothing it produces is committed to the repo.
