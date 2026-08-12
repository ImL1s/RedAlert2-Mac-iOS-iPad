# ADR-001: Android Native Shell Architecture & Baseline Pinning

- **Status**: Proposed
- **Date**: 2026-08-12
- **Author**: ImL1s (via automated port analysis)
- **Baseline Git Commit SHA**: `991945d60a7139d3c4c438326abb6d3c093b2497`
- **Parent Epic**: [#1 — Android v0.1](https://github.com/ImL1s/RedAlert2-Mac-iOS-iPad/issues/1)
- **Scope**: Architecture contracts and system boundaries for Android v0.1

> **PUBLIC_RELEASE_BLOCKED = true**
> This ADR documents the *target* architecture. No implementation exists yet.
> Public release remains blocked until [issue #2](https://github.com/ImL1s/RedAlert2-Mac-iOS-iPad/issues/2)
> (licensing, provenance, and public-distribution gate) reaches an evidence-backed
> release-eligible disposition **AND** every required engineering and release gate
> passes. Closing all technical P0 issues alone does not promote public-release
> eligibility. Private/sideload technical builds are distinct from release status.

---

## 1. Context & Problem Statement

The `RedAlert2-Mac-iOS-iPad` project ports the Chronodivide-lineage Red Alert 2 /
Yuri's Revenge TypeScript simulation engine to native mobile platforms. Following
the successful iOS port (detailed in `docs/PORTING_PLAYBOOK.md`), the goal of
Android v0.1 is to bootstrap a secure native Android application using Kotlin and
Android `WebView`.

Because EA's C&C source release excluded Red Alert 2, the core game logic runs as
a reconstructed deterministic TypeScript simulation engine coupled with a Three.js
WebGL renderer. Bridging this web engine to Android requires:

1. A robust Kotlin native shell wrapping a full-screen `WebView`.
2. Secure local content routing over the reserved WebView origin
   (`https://appassets.androidplatform.net/`).
3. Storage Access Framework (SAF) resource pack onboarding into Origin Private
   File System (OPFS).
4. Full Android lifecycle management (Audio Focus, Back Gestures, Thermal
   Throttling, Renderer Crash Recovery).
5. Absolute prevention of retail asset or private probe leakage into public CI
   or published artifacts.

### Upstream Relationship

This repository (`ImL1s/RedAlert2-Mac-iOS-iPad`) is a fork of
[`ammaarreshi/RedAlert2-Mac-iOS-iPad`](https://github.com/ammaarreshi/RedAlert2-Mac-iOS-iPad).
The upstream contains the iOS port. Android work MUST NOT break upstream iOS
behavior. Periodic sync with upstream is expected via merge (not rebase) to
preserve commit history.

---

## 2. Decision Drivers

- **Platform Neutrality**: Standardize shell host contracts
  (`window.__RA2_SHELL__`, `window.__RA2_POWER__`) so the TypeScript engine
  operates identically across iOS `WKWebView`, Android `WebView`, and
  standalone desktop browsers.
- **Zero Retail Asset Distribution**: The application binary and Git repository
  MUST contain zero retail C&C/RA2/YR game assets. All retail assets are
  imported at runtime via user-provided resource packs verified by Manifest v2.
- **Local Content Security**: Serve assets via `WebViewAssetLoader` under
  `https://appassets.androidplatform.net/`. No local HTTP server, no `localhost`
  binding. This domain is the reserved default provided by AndroidX WebKit;
  using a custom domain requires recorded proof of ownership.
- **Memory-Bounded Streaming**: Prevent whole-file memory allocations during
  game asset loading. Chunk size and whole-file thresholds TBD — will be
  measured and recorded in issue #17.
- **Resilience**: Handle process interruptions, audio focus preemptions,
  thermal throttling, and WebView renderer death without corrupting game
  simulation state or entering reload loops.

---

## 3. Target Support Matrix

> These are *targets*, not verified claims. Actual device, FPS, memory, GPU,
> and form-factor results remain **UNPROVEN** until measured on real hardware
> and documented as each issue is closed.

| Category | Target |
|---|---|
| **Min SDK** | API Level 29 (Android 10) — aligned with Epic #1 contract |
| **Target SDK** | API Level 35 (Android 15) |
| **Architectures** | `arm64-v8a` (primary), `x86_64` (emulator) |
| **WebView** | Android System WebView / Chrome 100+ with WebGL 2.0 & OPFS |
| **Form Factors** | Phones, Tablets, Foldables (display cutout adaptive) |
| **Input** | Touch (RTS tap/box/drag/pinch); Bluetooth/USB peripherals (future — #24) |

### SDK & Distribution Notes

- Epic #1 specifies "Android 10 / API 29 or newer" as the product contract.
  Do not claim API 24 (Android 7.0) support without amending Epic #1 with
  evidence (e.g., WebView feature availability, device population data).
- Google Play submissions from **2026-08-31** require `targetSdk = 36` for
  ordinary new apps and updates. The current `targetSdk = 35` is sufficient
  for private/sideload technical builds. Play eligibility requires a future
  target SDK bump and is tracked separately.
- Private/sideload technical builds are explicitly distinct from Play-eligible
  public releases. Technical build readiness does not imply distribution
  readiness (see issue #2).

### Performance Tiering

Performance tiers and budgets (FPS targets, memory limits, streaming thresholds,
thermal policies) are **TBD**. They will be measured on real devices and recorded
in issue [#17](https://github.com/ImL1s/RedAlert2-Mac-iOS-iPad/issues/17).

---

## 4. Target Architecture

```
                       ┌─────────────────────────────────────────┐
                       │          Android Kotlin Shell           │
                       │               (android/)                │
                       │                                         │
                       │  ┌───────────────────────────────────┐  │
                       │  │         MainActivity.kt           │  │
                       │  │  - Activity lifecycle             │  │
                       │  │  - Back gestures & audio focus    │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │          WebViewHost.kt           │  │
                       │  │  - Full-screen WebView            │  │
                       │  │  - Renderer crash recovery        │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │    LocalContentWebViewClient.kt   │  │
                       │  │  - WebViewAssetLoader routing     │  │
                       │  │  - Navigation guard (block ext.)  │  │
                       │  │  - Memory-bounded streaming       │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │      SafResourcePackManager       │  │
                       │  │  - SAF onboarding & persisted URI │  │
                       │  │  - Manifest v2 preflight verify   │  │
                       │  └───────────────────────────────────┘  │
                       └────────────────────┬────────────────────┘
                                            │
                              Native Bridge / Local Router
                                            │
                       ┌────────────────────▼────────────────────┐
                       │        TypeScript Web Game Engine       │
                       │              (redalert2/)               │
                       │                                         │
                       │  - window.__RA2_SHELL__ platform host   │
                       │  - window.__RA2_POWER__ thermal bridge  │
                       │  - nativeBridge.ts (platform-neutral)   │
                       │  - OPFS seeder (chunked, resumable)     │
                       └─────────────────────────────────────────┘
```

---

## 5. Fail-Closed Invariants

These invariants MUST hold in every merged PR and published artifact.
Violations block release.

- **FC-1: Resource Pack Integrity Gate**
  If any user-selected resource pack fails Manifest v2 preflight verification
  (SHA-256 hash mismatch, file size discrepancy, missing file, or schema version
  ≠ 2), seeding MUST fail closed. The app refuses to import unverified assets
  and returns to the onboarding UI. Empty `sha256` fields MUST be rejected
  (no bypass via omission).

- **FC-2: Zero Public Asset Leakage Gate**
  CI builds must run forbidden-asset scans. If any retail game asset signature,
  private smoke probe binary, or private key is detected in git commits, APK
  outputs, or CI logs, the build fails with non-zero exit. The scan must check
  file content (magic bytes), not just extensions.

- **FC-3: Strict Origin Isolation Gate**
  `WebView` settings: `allowFileAccess = false`, `allowContentAccess = false`.
  `shouldOverrideUrlLoading` must block all navigation outside
  `https://appassets.androidplatform.net/`. Origin validation for the native
  bridge must use exact HTTPS scheme + host + effective-port matching.

  **Native bridge security contract:**

  Sensitive native operations (any method that reads, writes, or exposes user
  data, storage paths, device state, or lifecycle control) MUST use an
  origin-scoped mechanism:

  * **Preferred**: `WebViewCompat.addWebMessageListener` with exact
    allowed-origin rules (scoped to `https://appassets.androidplatform.net`).
    This provides caller-origin validation per message.
  * **Alternative**: A supported origin-restricted `WebViewBuilder` /
    `RestrictionAllowlist` implementation, after an explicit dependency review
    and documentation of the origin-restriction guarantee.

  **Legacy `addJavascriptInterface` limitations (recorded for reference):**
  `addJavascriptInterface` is visible to every frame in the WebView and does
  not reveal the caller frame's origin. `webView.url` (or an
  `AtomicReference`-tracked equivalent) reflects the top-level page URL, not
  the calling frame. Therefore `addJavascriptInterface` cannot provide
  per-frame origin authentication and MUST NOT be the authorization boundary
  for sensitive operations.

  A legacy JavaScript interface MAY expose non-sensitive constants (e.g.,
  platform name, version string) only when the WebView is proven to contain
  no third-party frames. This exception must be documented per-method and
  reviewed per-PR.

- **FC-4: Memory-Bounded Streaming Gate**
  Asset streaming must not load whole files into RAM via `arrayBuffer()` for
  files above a configurable threshold. Streaming must use chunked reads.
  Specific thresholds will be set in issue #17.

- **FC-5: Renderer Death Throttled Recovery Gate**
  `onRenderProcessGone` recovery must be limited (e.g., max N attempts in T
  minutes). Pending delayed tasks must be cancelled in `onDestroy()` to prevent
  Activity leaks. If recovery limit is exceeded, a user-facing error screen is
  shown instead of a crash loop.

- **FC-6: Document-Start Shell Metadata Contract**
  Shell metadata (`window.__RA2_SHELL__`) must be injected **before** the
  first page script executes, using an origin-scoped document-start API
  (e.g., `WebViewCompat.addDocumentStartJavaScript` with origin rules scoped
  to `https://appassets.androidplatform.net`).

  `onPageFinished()` injection is **too late** for boot-time platform
  detection: by that point, the TypeScript engine's initialization has already
  read `window.__RA2_SHELL__` and made platform decisions. If the available
  WebView version does not support a document-start API, the shell MUST fail
  to an honest setup/error state (e.g., "WebView update required") rather
  than silently booting as a desktop browser.

---

## 6. Issue Dependency Graph

```
#3 ADR ──┬── #4 Platform-neutral bridge ──── #5 Kotlin shell scaffold
         │                                       │
         ├── #9 Remove retail CSF                │
         │   └── #8 Manifest v2                  ├── #7 Local content routing
         │       ├── #11 Pack verification       │   ├── #10 SAF onboarding
         │       └── #12 OPFS seeding            │   └── #16 Display & touch
         │                                       │
         │                                       ├── #13 Lifecycle
         │                                       │   ├── #14 Renderer recovery
         │                                       │   └── #15 Thermal/power
         │                                       │
         │                                       └── #18 Diagnostics
         │
         └── #20 CI pipeline ── #19 E2E tests ── #21 Docs
```

---

## 7. Consequences & Open Questions

### Positive
- Standardizes Android shell contracts before implementation starts.
- Fail-closed invariants prevent security regressions per-PR.
- Atomic PR split enables independent review and bisection.

### Open Questions (to be resolved in implementation PRs)
- **INTERNET permission**: Is it needed at all? If yes, restrict to
  `android:usesCleartextTraffic="false"` and evaluate `NetworkSecurityConfig`.
- **ProGuard/R8**: Enable for release builds; add `@Keep` rules for bridge
  methods exposed via `addWebMessageListener` callbacks.
- **`ra2cd.mix` fate**: Determine if it contains only custom assets (keep) or
  retail-derived content (remove with migration path).
- **`prepare-gameres.ts` CSF output**: Currently writes CSF to
  `redalert2/public/` (for Vite dev) and `gameres-export/` (canonical). Both
  paths contain retail-derived assets and must not enter Git or public builds.
- **Document-start API availability**: `WebViewCompat.addDocumentStartJavaScript`
  requires `WebView` ≥ 111 and `AndroidX WebKit` ≥ 1.9.0. Verify availability
  on the minimum supported device matrix. If unavailable, the error state path
  described in FC-6 applies.

---

## 8. Verification Strategy

Each implementation PR must include its own verification. This ADR does not
claim any test coverage. The following tools are *planned* (not yet implemented):

| Tool | Purpose | Implemented In |
|---|---|---|
| `./gradlew test` | Kotlin JVM unit tests | Issue #5+ |
| Forbidden-asset scanner | Verify 0 retail assets in APK | Issue #20 |
| Playwright E2E suite | Cross-platform web engine tests | Issue #19 |
| Device-matrix soak test | Real-device stability | Issue #19 |
| Technical probe | Embedded-resource skirmish test | Issue #6 |
