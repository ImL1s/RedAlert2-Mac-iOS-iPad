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
| **WebView** | Android System WebView with WebGL 2.0, OPFS, and document-start script support (see FC-6). Providers lacking required features fail closed. |
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
  This gate has three distinct scopes:

  1. **Regression scan** (CI-enforced): scan the current tracked tree and every
     newly introduced blob in the immutable Android baseline range
     `991945d60...HEAD` (or an explicitly reviewed equivalent range). Catches
     retail assets that were committed and deleted within the Android work.
     The scan must check file content (magic bytes), not just extensions.
     If any retail game asset signature, private smoke probe binary, or
     private key is detected, the build fails with non-zero exit.

  2. **Build artifact scan** (CI-enforced): scan WebDist output, staging
     directories, APK, AAB, symbols, and every upload candidate before
     upload. Fails the build if any forbidden content is detected.

  3. **Historical provenance** (tracked by issue #2): known pre-baseline
     reachable retail blobs (e.g., `redalert2/public/ini.mix` in ancestor
     `3ebf6d1`, confirmed retail by `cf899d4`) exist in the repository
     history. CI MUST NOT claim the entire repository history is clean.
     `PUBLIC_RELEASE_ELIGIBLE` remains blocked until the history is purged
     (e.g., `git filter-repo`), a clean distribution repository is created,
     or issue #2 records another evidence-backed disposition.

- **FC-3: Strict Origin Isolation Gate**
  `WebView` settings: `allowFileAccess = false`, `allowContentAccess = false`,
  `setMixedContentMode(MIXED_CONTENT_NEVER_ALLOW)`.

  **Network permission contract:**

  Sideload/no-retail and release production flavors MUST NOT declare
  `android.permission.INTERNET`. Android v0.1 is an offline local-content
  app; in-app WebView content served from assets does not require network
  permission. This is the strongest subresource isolation: without the
  permission, the OS blocks all outbound connections regardless of WebView
  configuration.

  If a future reviewed flavor legitimately requires network access, it MUST
  satisfy all of the following before the INTERNET permission is added:

  * `shouldOverrideUrlLoading` blocks all navigations outside
    `https://appassets.androidplatform.net/`.
  * `shouldInterceptRequest` returns a non-null error response (e.g., 403)
    for all requests whose scheme+host does not match
    `https://appassets.androidplatform.net`. Returning `null` is prohibited
    because it allows WebView to fall back to network loading.
  * Service Worker requests are subject to the same deny policy.
  * The game WebView must never use direct network fallback for appassets
    requests or executable subresources. Every appassets request must return
    verified local content or an explicit error response.
    `shouldInterceptRequest` does not receive redirect URLs — only the
    initial request URL — so redirect validation inside WebView callbacks
    is not possible. Any future permitted remote data fetch must use a
    native HTTP client (e.g., OkHttp) with automatic redirects disabled.
    Redirects may be followed only manually, with scheme, host, effective
    port, method, and destination validated at every hop. Remote HTML or
    executable script content must not be injected into the game WebView.
  * A default-deny Content-Security-Policy is injected at document start:
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
  * A network-capable WebView MUST NOT automatically receive the sensitive
    native bridge; a separate threat model is required.
  * A complete threat model for the network-capable flavor is documented
    and reviewed before merge.

  Origin validation for the native bridge must use exact HTTPS scheme +
  host + effective-port matching.

  **Native bridge security contract:**

  Sensitive native operations (any method that reads, writes, or exposes user
  data, storage paths, device state, or lifecycle control) MUST use an
  origin-scoped mechanism:

  * **Preferred**: `WebViewCompat.addWebMessageListener` with exact
    allowed-origin rules (scoped to `https://appassets.androidplatform.net`).
    This provides caller-origin validation per message. The implementation
    MUST verify `WebViewFeature.isFeatureSupported(WEB_MESSAGE_LISTENER)`
    at runtime before registration; if unsupported, the shell fails to an
    error state rather than falling back to an unscoped mechanism.
  * **Experimental alternative only**: `WebViewBuilder` /
    `RestrictionAllowlist` (`@WebViewBuilder.Experimental`) may be evaluated
    after explicit experimental API opt-in, dependency review, and runtime
    feature detection (`WEBVIEW_BUILDER_EXPERIMENTAL_V1` /
    `WEBVIEW_BUILDER_EXPERIMENTAL_V2`). It is NOT the default v0.1 security
    path and must not be used without documenting the experimental status
    and fallback behavior.

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

- **FC-5: Renderer Death Destruction and Bounded Recreation Gate**
  When `onRenderProcessGone` fires, the affected WebView instance is
  permanently unusable. `reload()` or continued use of the dead instance
  is prohibited. Recovery MUST:

  1. Remove the affected WebView from its view hierarchy.
  2. Call `destroy()` on it and clear all retained references (fields,
     closures, message listeners).
  3. Recreate a fresh WebView instance with the complete hardened
     configuration: `WebViewClient`, `WebChromeClient`, `WebViewAssetLoader`,
     origin-scoped bridge (`addWebMessageListener`), `MIXED_CONTENT_NEVER_ALLOW`,
     `allowFileAccess = false`, `allowContentAccess = false`, and
     document-start scripts.
  4. Restore only validated shell state, then load the local entry point.
  5. Return `true` from `onRenderProcessGone` after every affected WebView
     sharing the renderer has been handled.

  Retry limits apply to fresh-instance recreation (e.g., max N attempts in
  T minutes), never to `reload()` of a dead instance. If the Activity is
  not foreground/resumed, recreation is deferred until the next safe
  foreground transition. Pending callbacks and delayed tasks must be
  cancelled during destruction to prevent Activity leaks. After the bounded
  retry limit, show an honest terminal error state.

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
- **INTERNET permission**: FC-3 now prohibits it for sideload/production
  flavors. If a future network-capable flavor is proposed, it must satisfy
  the full subresource isolation contract in FC-3 and provide a threat model.
- **ProGuard/R8**: Enable for release builds; add `@Keep` rules for bridge
  methods exposed via `addWebMessageListener` callbacks.
- **`ra2cd.mix` fate**: Determine if it contains only custom assets (keep) or
  retail-derived content (remove with migration path).
- **`prepare-gameres.ts` CSF output**: Currently writes CSF to
  `redalert2/public/` (for Vite dev) and `gameres-export/` (canonical). Both
  paths contain retail-derived assets and must not enter Git or public builds.
- **Document-start API availability**: `WebViewCompat.addDocumentStartJavaScript`
  requires `AndroidX WebKit` ≥ 1.9.0 and a runtime WebView provider that reports
  `DOCUMENT_START_SCRIPT` as supported. Verify availability on the minimum
  supported device matrix during issue #5 implementation. Providers that do not
  report this feature fall into the FC-6 error state path. No minimum Chrome/
  WebView version number is stated here — the contract is feature-based.

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
