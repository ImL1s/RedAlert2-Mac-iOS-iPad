# Android v0.1 Device Matrix, Soak & Quality Gates

**Document Version**: 1.0.0  
**Epic**: #1 Android v0.1 Port  
**Issue**: #19 [P0] Build Android E2E, device-matrix, soak, and AI-liveness release gates  
**Date**: 2026-08-14  

---

## 1. Device Form Factor Matrix

| Device Class | Viewport (px) | DPI / Density | Aspect Ratio | Input Modality | Representative Hardware |
|---|:---:|:---:|:---:|:---:|---|
| **Compact Phone** | 360 x 780 | 3.0x (xxhdpi) | 19.5:9 | Multi-touch, Cutout | Pixel 5, Galaxy S21 |
| **Standard Flagship** | 390 x 844 | 3.0x (xxhdpi) | 19.5:9 | Multi-touch, Dynamic Island | Pixel 8, Galaxy S24 |
| **Large Phablet** | 412 x 915 | 3.5x (xxxhdpi) | 20:9 | Multi-touch | Galaxy S24 Ultra, Pixel 8 Pro |
| **Compact Tablet (8")**| 800 x 1280 | 1.5x (hdpi) | 16:10 | Touch, Dual-hand HUD | Lenovo Tab M8 |
| **Standard Tablet (11")**| 1024 x 768 / 1200 x 1920 | 2.0x (xhdpi) | 16:10 | Touch, Keyboard, Stylus | Galaxy Tab S9, Pixel Tablet |
| **Foldable (Cover)** | 672 x 884 | 2.6x (xxhdpi) | 23:9 | Single-hand touch | Galaxy Z Fold 5 (Closed) |
| **Foldable (Inner Unfolded)** | 1768 x 2208 | 2.6x (xxhdpi) | 6:5 | Dual-hand touch, Expanded Radar | Galaxy Z Fold 5 (Open) |
| **Desktop / DeX Mode** | 1920 x 1080 | 1.0x (mdpi) | 16:9 | Hardware Mouse & Keyboard | Samsung DeX, Motorola Ready For |

---

## 2. Android OS & WebView Engine Matrix

| Target Layer | Minimum Version | Recommended / Target | Strict Release Gate Requirement |
|---|:---:|:---:|---|
| **Android OS API** | API 28 (Android 9.0 Pie) | API 34 / 35 (Android 14/15) | Core features pass on API 28+; Thermal listener active on API 29+. |
| **Android System WebView** | Version 89.0 (OPFS origin) | Version 120.0+ | `WebViewCompat.isFeatureSupported(DOCUMENT_START_SCRIPT)` supported. |
| **WASM Memory Limit** | 512 MB WebAssembly max | 1024 MB WebAssembly max | Must execute 7-Zip decompression without OOM crash. |
| **Storage Framework** | SAF (DocumentsContract) | SAF with persisted URI | Must operate with zero `WRITE_EXTERNAL_STORAGE` permission. |

---

## 3. 60-Minute Soak Test Specification

The 60-minute continuous skirmish soak test validates sustained system stability under maximum combat load:

### 3.1 Simulation Configuration
- **Map**: 8-player symmetric map (`eb8.map` or representative).
- **Participants**: 1 Human / Observer + 7 AI Bots (2 Easy, 3 Normal, 2 Brutal).
- **Duration**: 25,000 game simulation ticks (~60 minutes at 15/30 TPS).
- **Speed**: Uncapped headless stepping.

### 3.2 Gate Acceptance Criteria

| Metric | Target / Floor | Failing Condition (Release Blocker) |
|---|:---:|---|
| **Peak Heap / RAM** | $\le 450\text{ MB}$ (Nominal) | Exceeds **650 MB** or triggers LowMemoryKiller. |
| **Unhandled Errors** | `0` errors | Any unhandled JS exception or Kotlin crash. |
| **AI Bot Liveness** | 100% active | Any bot with 0 attacks or building loop stall. |
| **Lockstep Determinism** | 0 desyncs | Any non-deterministic `Math.random()` / `Date.now()` call in sim. |
| **Per-Bot AI Cost** | $\le 0.5\text{ ms/tick}$ | Exceeds **1.0 ms/tick** average on device. |
| **Total Sim Cost** | $\le 4.0\text{ ms/tick}$ | Exceeds **8.0 ms/tick** average on device. |

---

## 4. Fault-Injection Matrix

| Fault Scenario | Injection Method | Expected Fail-Closed Behavior |
|---|---|---|
| **Renderer Crash** | Terminate WebView render process (`killRendererProcess()`) | `WebViewHost.kt` detaches, destroys dead instance, recreates fresh instance up to 3 times per 5 minutes. |
| **SAF Revocation** | Revoke tree URI authorization via `ContentResolver` | App transitions safely to onboarding screen with clear notification; no crash. |
| **Thermal Emergency** | Fire `THERMAL_STATUS_CRITICAL` | Game engine dynamically drops visual frame rate to 15 FPS while maintaining deterministic simulation rate. |
| **Corrupted OPFS File** | Truncate single `.mix` file in OPFS | Resumable seeder detects size/SHA mismatch during preflight, marks file `PENDING`, and re-streams. |
| **Storage Exhaustion** | Provide storage volume with <900MB free | Preflight fails early with `INSUFFICIENT_STORAGE` before starting OPFS copy. |
