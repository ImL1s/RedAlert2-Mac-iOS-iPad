# ADR-001: Android Native Shell Architecture & Baseline Pinning

- **Status**: Accepted
- **Date**: 2026-08-12
- **Baseline Git Commit SHA**: `991945d60a7139d3c4c438326abb6d3c093b2497`
- **Scope**: Milestone M1 — Architecture, System Boundaries, and Compliance Contracts

---

## 1. Context & Problem Statement

The `RedAlert2-Mac-iOS-iPad` project ports the Chronodivide-lineage Red Alert 2 / Yuri's Revenge TypeScript simulation engine to native mobile platforms. Following the successful iOS port (detailed in `docs/PORTING_PLAYBOOK.md`), the goal of Version 0.1 is to bootstrap a secure, high-performance native Android application using Kotlin and Android `WebView`.

Because EA's C&C source code release excluded Red Alert 2, the core game logic runs as a reconstructed deterministic TypeScript simulation engine coupled with a Three.js WebGL renderer. Bridging this web engine to Android requires:
1. A robust Kotlin native shell wrapping a full-screen `WebView`.
2. Secure local content routing over a custom origin (`https://appassets.androidlocal/`).
3. Storage Access Framework (SAF) resource pack onboarding into Origin Private File System (OPFS).
4. Full Android lifecycle management (Audio Focus, Back Gestures, Thermal Throttling, Renderer Crash Recovery).
5. Absolute prevention of retail asset or private probe leakage into public CI repositories.

This ADR pins the architecture, baseline SHA, device support matrix, interface contracts, and fail-closed security invariants for the Android v0.1 release.

---

## 2. Decision Drivers

- **Platform Neutrality**: Standardize shell host contracts (`window.__RA2_SHELL__`, `window.__RA2_POWER__`) so the TypeScript engine operates identically across iOS `WKWebView`, Android `WebView`, and standalone desktop browsers.
- **Zero Retail Asset Distribution**: The application binary and Git repository MUST contain zero retail C&C/RA2/YR game assets. All retail assets are imported at runtime via user-provided resource packs verified by Manifest v2.
- **Local Content Security**: Avoid running a local HTTP server or binding to `localhost` ports. Serve assets via `WebViewAssetLoader` / custom stream interceptor under `https://appassets.androidlocal/`.
- **Memory-Bounded Streaming**: Prevent whole-file memory allocations during game asset streaming by implementing 64KB chunked stream buffers.
- **Resilience**: Handle process interruptions, audio focus preemptions, thermal throttling, and WebView renderer death without corrupting game simulation or entering reload loops.

---

## 3. Support Matrix

| Category | Requirement / Specification |
|---|---|
| **Min SDK** | API Level 24 (Android 7.0 Nougat) |
| **Target SDK** | API Level 34 / 35 (Android 14 / 15) |
| **Architectures** | `arm64-v8a` (Primary), `x86_64` (Emulator verification) |
| **WebView Component** | Android System WebView / Chrome 100+ with WebGL 2.0 & OPFS (`navigator.storage`) |
| **Display Form-Factors** | Handheld Phones, Tablets, Foldables (Display Cutout & Aspect-Ratio Adaptive) |
| **Input Modes** | Touch Gestures (RTS tap/box/drag/pinch), Bluetooth/USB Mouse & Keyboard (Optional) |

### Memory & Performance Tiering

| Tier | System RAM | Target Resolution & FPS | Streaming Buffer | Thermal Policy |
|---|---|---|---|---|
| **Tier 1 (Low)** | $\le$ 3 GB | Logical 800x480 @ 30 FPS | 64 KB chunk, 8 MB whole-file threshold | FPS throttled to 30 FPS on `FAIR` thermal state |
| **Tier 2 (Standard)** | 4 GB – 6 GB | Logical 800x480 / Native @ 60 FPS | 64 KB chunk, 16 MB whole-file threshold | FPS throttled to 30 FPS on `SERIOUS` thermal state |
| **Tier 3 (High)** | $\ge$ 8 GB | Native Display Res @ 60 / 120 FPS | 64 KB chunk, 32 MB whole-file threshold | FPS throttled to 30 FPS on `CRITICAL` thermal state |

---

## 4. Architecture & Module Boundaries

```
                       ┌─────────────────────────────────────────┐
                       │          Android Kotlin Shell           │
                       │               (`android/`)              │
                       │                                         │
                       │  ┌───────────────────────────────────┐  │
                       │  │         MainActivity.kt           │  │
                       │  │  - Activity Lifecycle             │  │
                       │  │  - Back Gestures & Audio Focus    │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │          WebViewHost.kt           │  │
                       │  │  - Fullscreen WebView             │  │
                       │  │  - onRenderProcessGone Recovery   │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │    LocalContentWebViewClient.kt   │  │
                       │  │  - WebViewAssetLoader / Scheme    │  │
                       │  │  - Memory-Bounded Chunk Streaming │  │
                       │  └─────────────────┬─────────────────┘  │
                       │                    │                    │
                       │  ┌─────────────────▼─────────────────┐  │
                       │  │      SafResourcePackManager       │  │
                       │  │  - SAF Onboarding & Persisted Uri │  │
                       │  │  - Manifest v2 Preflight Verify   │  │
                       │  └───────────────────────────────────┘  │
                       └────────────────────┬────────────────────┘
                                            │
                              Native Bridge / Local Router
                                            │
                       ┌────────────────────▼────────────────────┐
                       │        TypeScript Web Game Engine       │
                       │              (`redalert2/`)             │
                       │                                         │
                       │  - window.__RA2_SHELL__ Platform Host  │
                       │  - window.__RA2_POWER__ Thermal Bridge  │
                       │  - nativeBridge.ts / nativeSeeder.ts    │
                       │  - OPFS Storage (`navigator.storage`)   │
                       └─────────────────────────────────────────┘
```

---

## 5. Fail-Closed Invariants

- **FC-1: Resource Pack Integrity Gate**
  If any user-selected resource pack fails Manifest v2 preflight verification (SHA-256 hash mismatch, file size discrepancy, missing file, or schema version != 2), seeding MUST fail closed. The app will refuse to import unverified assets and return to the onboarding UI.

- **FC-2: Zero Public Asset Leakage Gate**
  CI build pipelines must run static asset scanners (`scripts/ci-forbidden-asset-scanner.py`). If any retail game asset signature, private smoke probe binary, or private key is detected in git commits, APK build outputs, or CI logs, the CI build will fail immediately with non-zero exit code.

- **FC-3: Strict Origin Isolation Gate**
  `WebView` settings must explicitly disable file scheme access (`allowFileAccess = false`, `allowContentAccess = false`, `allowFileAccessFromFileURLs = false`). All communication and resource loading MUST route through `https://appassets.androidlocal/`. External navigation is blocked.

- **FC-4: Memory-Bounded Chunk Streaming Gate**
  Large asset streams handled by `LocalContentWebViewClient` must not load whole files into RAM byte arrays. All streaming responses must use a fixed 64KB `InputStream` buffer to keep native heap overhead bounded under 16MB across all operations.

- **FC-5: Renderer Death Throttled Recovery Gate**
  When `onRenderProcessGone` is triggered, `WebViewHost` must limit auto-recovery reloads to at most 3 attempts within a 5-minute window. If additional renderer crashes occur within 5 minutes, auto-reload is aborted, and a user-facing safe error screen is presented.

---

## 6. Consequences & Verification

- **Positive Impact**: Standardizes Android shell contracts, ensures compliance with open-source asset rules, guarantees lifecycle resilience, and isolates web execution from host OS vulnerabilities.
- **Verification Strategy**:
  - `gradlew test`: Unit test native components (`SafResourcePackManagerTest`, `LocalContentWebViewClientTest`).
  - `scripts/ci-forbidden-asset-scanner.py`: Verify 0 retail asset signatures in release artifacts.
  - `PrivateSmokeTest.kt`: Local-only embedded private probe execution verifying 100-tick skirmish stability inside Android WebView.
