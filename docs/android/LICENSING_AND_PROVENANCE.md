# Android Port: Licensing, Provenance & Public-Distribution Gate

- **Document Version**: 1.0.0
- **Status**: Enforced
- **Tracking Issue**: [#2 — Licensing, Provenance, and Distribution Gate](https://github.com/ImL1s/RedAlert2-Mac-iOS-iPad/issues/2)
- **ADR Reference**: `docs/adr/001-android-architecture.md` (ADR-001)
- **Machine-Readable Gate**: `docs/android/release-status.json` (`PUBLIC_RELEASE_BLOCKED = true`)

---

## 1. Executive Summary & Core Principle

This document establishes the legal provenance framework, component licensing boundaries, and public distribution gate for the RedAlert2 Android port.

```
+-----------------------------------------------------------------------------+
|                               RELEASE GATE                                  |
|                                                                             |
|                      PUBLIC_RELEASE_BLOCKED = true                          |
|                                                                             |
|  Public distribution of binaries (e.g. Play Store, F-Droid, public APKs)   |
|  is strictly BLOCKED. Building or running Android artifacts is permitted    |
|  ONLY for local private developer testing and research with user-owned      |
|  game assets.                                                               |
+-----------------------------------------------------------------------------+
```

---

## 2. Component Provenance & Licensing Boundaries

The Android port incorporates software components from distinct sources with varying licensing terms:

### 2.1 Android Kotlin Shell (`android/`)
- **Origin**: Created specifically for this project (`ImL1s/RedAlert2-Mac-iOS-iPad`).
- **License**: **GPL-3.0-or-later**.
- **Dependencies**: Standard AndroidX libraries (`androidx.webkit`, `androidx.activity`, `androidx.documentfile`, `androidx.lifecycle`) governed by Apache 2.0.
- **Provenance**: Authored by repository contributors.

### 2.2 Reconstructed Game Engine (`redalert2/`)
- **Origin**: Vendored from [`huangkaoya/redalert2`](https://github.com/huangkaoya/redalert2) at commit `8c07f10`, which declared **GPL-3.0**.
- **Lineage**: Descends from **Chrono Divide** by **Alexandru Ciucă** (<https://chronodivide.com>), continued as **RA2WEB** (<https://www.ra2web.com>).
- **Legal Status**: **UNVERIFIED GRANT**. Chrono Divide's original game client was not released under an open-source license by its author. Upstream declared GPL-3.0 without explicit copyright transfer.
- **Disposition**: Documented transparently. If Alexandru Ciucă or rightsholders object, this code is taken down immediately.

### 2.3 Skirmish AI (`redalert2/src/game/ai/thirdpartbot/`)
- **Origin**: Derived from [Supalosa's Chrono Divide bot](https://github.com/Supalosa/supalosa-chronodivide-bot).
- **License**: Declared as `"license": "UNLICENSED"`.
- **Disposition**: Educational and research fork pending explicit upstream licensing.

### 2.4 7-Zip WebAssembly (`redalert2/public/7zz.wasm`)
- **Origin**: 7-Zip (Igor Pavlov).
- **License**: **LGPL-2.1-or-later** with the unRAR restriction (<https://www.7-zip.org/license.txt>).
- **Disposition**: Permissible for runtime extraction of user-owned archives; unRAR logic is not invoked.

### 2.5 Typography & UI Sprites
- **Fira Sans Condensed**: **SIL Open Font License 1.1** (Mozilla & Telefonica).
- **js-fileexplorer**: **MIT / LGPL** (CubicleSoft).

---

## 3. Electronic Arts & Westwood Intellectual Property

- **Trademarks**: *Command & Conquer*, *Red Alert*, and *Yuri's Revenge* are registered trademarks of **Electronic Arts Inc.**
- **Affiliation**: This project is **unaffiliated with, unendorsed by, and unsupported by Electronic Arts Inc.**
- **Retail Game Assets**:
  - **Zero proprietary assets are distributed by this repository.**
  - All `.mix`, `.csf`, `.bik`, `.vqp`, `.bag`, `.wav`, and palette files must be provided at runtime by the user from their legally-owned retail installation (e.g. Steam Command & Conquer The Ultimate Collection).
  - WebDist and compiled APKs are statically scanned to ensure 0-retail asset leakage.

---

## 4. Distribution Tier Taxonomy

| Distribution Tier | Eligibility | Prerequisites / Restrictions |
|---|---|---|
| **Source Code Publication** | **ELIGIBLE** | Open-source research and educational use under component licenses. Zero retail assets in git. |
| **Private Sideload APK** | **ELIGIBLE (LOCAL ONLY)** | Developer local build (`./gradlew assembleDebug`), private smoke probe testing. No public binary hosting. |
| **Public No-Retail Shell APK** | **BLOCKED** | Requires resolution of upstream copyright/licensing chain (Chrono Divide / Alexandru Ciucă grant). |
| **App Store (Google Play / F-Droid)** | **PERMANENTLY BLOCKED** | Trademark restrictions, unverified copyright chain, and platform distribution policies. |

---

## 5. Evidence-Backed Unblocking Criteria

To transition `PUBLIC_RELEASE_BLOCKED` from `true` to `false`, **ALL** of the following evidence-backed criteria must be satisfied and recorded in `docs/android/release-status.json`:

### 5.1 Legal Requirements
1. **Chrono Divide Relicensing**: Written confirmation or explicit open-source relicensing by Alexandru Ciucă and the Chrono Divide team.
2. **Supalosa Bot License Grant**: Upstream license resolution (MIT, Apache 2.0, or GPL-3.0) for the bot implementation.
3. **Trademark Clearance**: Formal assessment ensuring trademark usage complies with fair use and developer distribution terms.

### 5.2 Technical & Security Requirements
1. **Zero-Asset Leakage Enforcement**: Automated static scanner (`scripts/verify-no-retail-assets.sh`) running on all CI builds with zero violations.
2. **ADR-001 Invariant Adherence**: Complete verification of fail-closed invariants FC-1 through FC-6.
3. **Storage Access Framework Isolation**: User resource packs loaded strictly via SAF without requesting broad storage permissions (`MANAGE_EXTERNAL_STORAGE` or `READ_EXTERNAL_STORAGE`).

---

## 6. Machine-Readable Gate Verification

CI pipelines and build tools MUST query `docs/android/release-status.json` before executing any release packaging or distribution tasks:

```json
{
  "publicReleaseBlocked": true,
  "status": "DEVELOPMENT_PRIVATE_TESTING_ONLY"
}
```

If `publicReleaseBlocked` is `true`, any attempt to generate public release bundles or publish artifacts MUST immediately fail-closed.
