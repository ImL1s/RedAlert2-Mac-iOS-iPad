# On-Device Retail File Import & Transcoding Research

**Document Version**: 1.0.0  
**Epic**: #1 Android v0.1 Port  
**Issue**: #23 [RESEARCH] Evaluate safe on-device import of user-owned RA2/YR retail files  
**Primary Research Paper**: [`docs/research/023-on-device-import.md`](../research/023-on-device-import.md)  
**Date**: 2026-08-14  

---

## 1. Research Summary

This research investigates the technical viability of generating **Resource Pack Manifest v2** directly on an Android device from user-selected raw retail assets (ISO disc images, Steam installations, `.mix` archives), comparing WebAssembly and native background processing against the proven desktop toolchain (`scripts/prepare-gameres.ts`).

---

## 2. Technical Comparison: Desktop vs. On-Device Import

| Metric / Dimension | Desktop (`prepare-gameres.ts`) | On-Device WASM (In-WebView) | On-Device Native (`WorkManager`) |
|---|:---:|:---:|:---:|
| **Processing Duration** | **12–45 seconds** | 2–18 minutes | 1.5–6 minutes |
| **Peak Memory Consumption** | Unconstrained PC RAM | **800MB–1.3GB (High LMK Risk)** | 250MB–450MB |
| **Thermal Profile** | Nominal (Active Fan) | Heavy throttling ($>68^\circ\text{C}$) | Moderate throttling |
| **APK Binary Footprint** | **0 MB (Zero bloat)** | +35 MB (WASM FFmpeg/7z) | +8 MB (Native C++ libs) |
| **User Setup UX** | Copy prepared folder | Select raw folder on phone | Select raw folder on phone |
| **Integrity & Determinism** | 100% Verified SHA-256 | High risk of OOM mid-extract | Moderate risk on slow SD cards |

---

## 3. Core Bottlenecks Identified

1. **WebAssembly Memory Allocation Limit**: In-browser extraction of multi-hundred MB MIX archives requires large linear buffers, causing instant LowMemoryKiller termination on 3GB/4GB RAM Android devices.
2. **Thermal & Battery Impact**: Sustained 100% CPU multi-core decoding triggers Android OS thermal emergency modes (`THERMAL_STATUS_CRITICAL`), draining up to 5–8% battery before gameplay begins.
3. **SAF Directory Traversal**: Enumerating hundreds of nested files via Android SAF takes 4–12 seconds due to binder IPC round-trips.

---

## 4. Final Verdict & Staged Recommendation

- **Android v0.1 Decision: NO-GO for On-Device Import**. Keep `scripts/prepare-gameres.ts` as the standard, robust onboarding mechanism.
- **Android v0.2+ Outlook**: Build an experimental native background worker (`androidx.work.WorkManager`) for high-tier devices with $>6\text{GB}$ RAM, focusing on audio extraction only.

*For complete benchmark numbers, hardware tier tables, and architectural details, see [`docs/research/023-on-device-import.md`](../research/023-on-device-import.md).*
