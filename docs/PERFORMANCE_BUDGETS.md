# Android Performance, Memory, Startup, and Device-Tier Budgets

**Version**: 1.0 (Android v0.1 Release Gate)  
**Status**: Approved Baseline  
**Target Platform**: Android 10+ (API Level 29+), ARM64 / x86_64  
**Enforcement**: Automated CI Probes & Benchmark Suites  

---

## 1. Executive Summary & Objective

This document establishes the official performance, memory, startup, frame pacing, and hardware budget constraints for the Red Alert 2 Android port (`ra2web`). 

Adhering to these budgets ensures:
1. **LowMemoryKiller (LMK) Immunity**: Zero process terminations during match gameplay across supported Android memory tiers.
2. **Thermal Stability**: Sustainable gameplay frame rates without severe thermal runaway or uncontrolled hardware throttling.
3. **Deterministic Simulation Guarantees**: Independent execution of the simulation lockstep loop (fixed 15 or 30 TPS) regardless of visual render frame pacing caps.
4. **Predictable Storage Footprint**: Origin Private File System (OPFS) and RAM bounds strictly maintained in accordance with ADR-001 (ADR FC-4).

---

## 2. Hardware Device Tier Matrix

Android devices are categorized into four distinct operational tiers based on available system RAM, SoC architecture, and display form-factor:

| Tier | Typical Hardware Profile | Target Resolution | Recommended Visual Preset |
|---|---|:---:|:---:|
| **Tier 1: Low / Entry** | 3GB–4GB RAM, MediaTek Helio / Snapdragon 600-series | 1280×720 (720p) | Low / Medium |
| **Tier 2: Mid-Range** | 6GB RAM, Snapdragon 7s / 778G / Dimensity 8000 | 1920×1080 (1080p) | High (60 FPS default) |
| **Tier 3: Flagship / High** | 8GB–16GB RAM, Snapdragon 8 Gen 1/2/3, Tensor G3/G4 | Native / 2K | Ultra (60–120 FPS) |
| **Tier 4: Tablet / Foldable** | 8GB+ RAM, Large Canvas (Folded: 672×884, Unfolded: 1768×2208, Tablets: 2560×1600) | Native Retina | High / Side-by-Side HUD |

---

## 3. Quantitative Budget Matrix

| Metric Category | Low Tier (3GB RAM) | Mid Tier (6GB RAM) | High Tier (8GB+ RAM) | Tablet / Foldable | Strict Invariant / Hard Limit |
|---|:---:|:---:|:---:|:---:|:---:|
| **Cold Launch to Main Menu** | $\le 4.5\text{ s}$ | $\le 3.0\text{ s}$ | $\le 2.0\text{ s}$ | $\le 2.5\text{ s}$ | $\le 5.0\text{ s}$ |
| **Warm Launch / Resume** | $\le 1.0\text{ s}$ | $\le 0.5\text{ s}$ | $\le 0.3\text{ s}$ | $\le 0.5\text{ s}$ | $\le 1.5\text{ s}$ |
| **Peak Total RAM (Shell + WebView)** | $\le 350\text{ MB}$ | $\le 500\text{ MB}$ | $\le 650\text{ MB}$ | $\le 650\text{ MB}$ | Bounded by OS LMK Kill |
| **Native Dalvik/ART Heap** | $\le 45\text{ MB}$ | $\le 60\text{ MB}$ | $\le 80\text{ MB}$ | $\le 80\text{ MB}$ | $\le 128\text{ MB}$ |
| **WebView C++ / V8 / WebGL Heap** | $\le 250\text{ MB}$ | $\le 380\text{ MB}$ | $\le 500\text{ MB}$ | $\le 500\text{ MB}$ | Bounded by OS low memory |
| **Nominal Frame Rate (Unthrottled)** | 30–60 FPS | 60 FPS ($\le 16.6\text{ ms}$) | 60–120 FPS | 60 FPS | Target 60 FPS |
| **Throttled Frame Rate (Serious Thermal / Low Power)** | 20 FPS | 20 FPS | 20 FPS | 20 FPS | 20 FPS Cap (ADR FC-4 / #15) |
| **Throttled Frame Rate (Critical Thermal)** | 15 FPS | 15 FPS | 15 FPS | 15 FPS | 15 FPS Cap (ADR FC-4 / #15) |
| **Simulation Tick Rate (TPS)** | 15 / 30 TPS | 15 / 30 TPS | 15 / 30 TPS | 15 / 30 TPS | **Strict Lockstep Invariant** |
| **InputStream Buffer Size** | 64 KB | 64 KB | 64 KB | 64 KB | **Strict 64 KB (`BUFFER_SIZE_BYTES`)** |
| **HTTP Response Chunk Cap** | 4 MB | 4 MB | 4 MB | 4 MB | ADR FC-4 |
| **OPFS Total Storage Footprint** | $\le 800\text{ MB}$ | $\le 800\text{ MB}$ | $\le 800\text{ MB}$ | $\le 800\text{ MB}$ | Single pack unpacked size |

---

## 4. Memory Architecture & Breakdown

The Android application consists of two communicating processes/layers:
1. **Kotlin Shell Process (`com.ammaar.ra2web`)**:
   - Manages Activity lifecycle, window insets, DisplayCutout, SAF Uri authorizations, audio focus, and PowerManager thermal listeners.
   - Target Resident Set Size (RSS): $\le 40\text{ MB}$.
2. **Android WebView Render Process (`sandboxed_process`)**:
   - Executes V8 JavaScript engine, DOM tree, Three.js WebGL scene graph, and OPFS synchronous/asynchronous file handles.
   - Target RSS during 8-player skirmish: $\le 450\text{ MB}$.

### Memory Budget Allocations:

```
Total Memory Budget (500 MB Mid-Tier Baseline):
├── V8 Engine & JavaScript Heap: 120 MB
│   ├── Game State AST & Entity Graphs: 35 MB
│   ├── Spatial Partitioning & Pathfinding Grid: 25 MB
│   ├── Audio Buffers (Decoded Sound FX): 30 MB
│   └── UI / DOM / React / Event Handlers: 30 MB
├── WebGL & GPU Textures / Buffers: 220 MB
│   ├── VXL Voxel Mesh Geometries: 80 MB
│   ├── SHP Sprite Textures & Palettes: 90 MB
│   ├── Terrain Tiles & Isometric Grid: 30 MB
│   └── Framebuffers & Post-Processing Quads: 20 MB
├── Native WebView C++ Subsystems: 110 MB
│   ├── Blink Compositor & CC Layers: 40 MB
│   ├── Skia 2D & GPU Resource Cache: 45 MB
│   └── Network / Content Scheme Caches: 25 MB
└── Android Shell (Kotlin / ART Heap): 50 MB
```

---

## 5. Startup Milestones & Pacing Budgets

```
Cold Boot Timeline:
[0 ms] Activity Launch (Intent / Application.onCreate)
 ├─ [50 ms]  WebViewHost attached and WindowInsets computed
 ├─ [150 ms] WebViewEngine initialized & document-start script injected
 ├─ [350 ms] WebDist/index.html parsed & React DOM mounted
 ├─ [600 ms] OPFS `.seed_state.json` validated against Manifest v2
 ├─ [1200 ms] Core string tables (`ra2.csf`) and palettes loaded
 └─ [2000 ms] Main Menu Root Interactive (Cold Launch Complete)
```

### Warm Startup & Match Loading:
- **Warm Launch**: Returns to interactive menu or active match within $\le 500\text{ ms}$.
- **Skirmish Map Generation & World Construction**:
  - Small Map (2-player, 64×64): $\le 1.2\text{ s}$.
  - Medium Map (4-player, 96×96): $\le 2.0\text{ s}$.
  - Large Map (8-player, 128×128): $\le 3.5\text{ s}$.

---

## 6. Thermal Throttling & Power Policies

Thermal monitoring integrates directly with Android's `PowerManager.OnThermalStatusChangedListener` (API 29+):

| Thermal State | Android OS Status | Trigger Condition | Visual Render Cap | Lockstep Sim Rate |
|---|---|---|:---:|:---:|
| **`nominal`** | `THERMAL_STATUS_NONE` | Temperature normal ($< 38^\circ\text{C}$) | None (60–120 FPS) | 30 TPS |
| **`fair`** | `THERMAL_STATUS_LIGHT` / `MODERATE` | Slight heating ($38^\circ\text{C}–42^\circ\text{C}$) | None (60 FPS) | 30 TPS |
| **`serious`** | `THERMAL_STATUS_SEVERE` | Heavy heating ($43^\circ\text{C}–47^\circ\text{C}$) | **20 FPS** | 30 TPS |
| **`critical`** | `THERMAL_STATUS_CRITICAL` / `EMERGENCY` | Severe heat ($> 48^\circ\text{C}$) | **15 FPS** | 30 TPS |
| **`lowPower`** | Battery Saver Mode Active | User toggled battery saver | **20 FPS** | 30 TPS |

### Deterministic Isolation Guarantee:
Throttling adjusts **visual frame interpolation only** via `requestAnimationFrame`. The simulation loop remains on fixed delta-time accumulator ticks, preventing any desynchronization in local AI skirmishes or LAN multiplayer sessions.

---

## 7. Streaming I/O and Buffer Invariants (ADR FC-4)

To prevent Out-Of-Memory exceptions on constrained devices (Tier 1):
1. **Streaming Seeding**: `runOpfsSeeder` streams files in chunks of $\le 64\text{ KB}$ (`CHUNK_SIZE_BYTES = 65536`).
2. **No Whole-Pack In-Memory Buffering**: The shell and web layer never load the full 750MB user pack into an `ArrayBuffer`.
3. **Local Content Range Requests**: `LocalContentWebViewClient` serves asset requests via streaming `InputStream` readers bounded to 64KB buffers.
4. **Transient Reload Gate**: Upon completion of a first-launch OPFS seeding operation, the shell triggers a single clean reload to purge V8 memory high-water marks before initializing Three.js WebGL contexts.

---

## 8. Profiling & Verification Tooling

Engineers and QA agents verify compliance using the following automated and manual tooling:
- **Android Studio Profiler**: Inspect ART heap, native memory allocations, and CPU frequency scaling.
- **Perfetto System Tracing**: Capture thread scheduling, WebView rendering compositor pipelines, and Choreographer VSYNC events.
- **AI Liveness Soak Probes**: `scripts/private-smoke-probe.sh --ticks 1000` verifies memory plateau and leak-free execution over 1000 skirmish simulation steps.
- **Chrome Remote DevTools**: Attach to `appassets.androidplatform.net` via `chrome://inspect` to record V8 heap snapshots and WebGL draw calls.
