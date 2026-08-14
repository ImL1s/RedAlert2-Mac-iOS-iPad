# Android Local-Only Embedded Technical Probe

- **Status**: Documented & Available for Local Testing
- **Tracking Issue**: [#6 — Local-Only Embedded-Resource Android Technical Probe](https://github.com/ImL1s/RedAlert2-Mac-iOS-iPad/issues/6)
- **Flavor Dimension**: `privateSmoke` (`android/app/build.gradle.kts`)
- **Execution Script**: `scripts/private-smoke-probe.sh`

---

## 1. Overview & Purpose

The **Local-Only Embedded Technical Probe** provides an isolated developer workflow for testing the Red Alert 2 simulation engine, WebGL rendering pipeline, audio system, and native shell bridge directly inside the Android `WebView` without requiring the full runtime Storage Access Framework (SAF) folder selection and OPFS seeding UX.

```
+-----------------------------------------------------------------------------+
|                       LOCAL TECHNICAL PROBE ISOLATION                       |
|                                                                             |
|  The privateSmoke flavor embeds developer-staged assets locally into        |
|  android/app/src/privateSmoke/assets/GameRes.                               |
|                                                                             |
|  STRICT ISOLATION RULE:                                                     |
|  - privateSmoke assets and builds MUST NEVER be committed to Git.           |
|  - CI runs exclusively on the publicCi flavor (0 retail assets).            |
|  - scripts/verify-no-retail-assets.sh guarantees zero leakage.              |
+-----------------------------------------------------------------------------+
```

---

## 2. Product Flavor Architecture

The Android application defines two product flavors in `android/app/build.gradle.kts`:

```kotlin
flavorDimensions += "distribution"

productFlavors {
    create("publicCi") {
        dimension = "distribution"
    }
    create("privateSmoke") {
        dimension = "distribution"
        applicationIdSuffix = ".privatesmoke"
    }
}
```

### Flavor Characteristics:
- **`publicCi`**: Default production/CI flavor. Contains zero retail assets. Used for all pull request checks, unit tests, and release verification.
- **`privateSmoke`**: Developer-only debug flavor. Staged assets in `src/privateSmoke/assets/` are packaged only when building this specific flavor target.

---

## 3. Local Probe Workflow

### 3.1 Staging Probe Assets
1. Obtain verified export assets from a legally-owned copy using `scripts/prepare-gameres.ts`.
2. Copy the resulting export folder to `private-probe-assets/` at the repository root:
   ```bash
   mkdir -p private-probe-assets
   cp -R gameres-export/* private-probe-assets/
   ```
3. Run the automated private smoke probe script:
   ```bash
   ./scripts/private-smoke-probe.sh --ticks 100 --flavor privateSmokeDebug
   ```

### 3.2 Automated Probe Checks
`scripts/private-smoke-probe.sh` performs:
1. **Asset Staging**: Copies `private-probe-assets/` to `android/app/src/privateSmoke/assets/GameRes/`.
2. **Engine Validation**: Executes `bun test` to confirm bridge and simulation unit tests pass.
3. **Simulation Liveness**: Simulates a 100-tick skirmish loop to verify step-loop determinism and state stability.

---

## 4. Git & Asset Isolation Safeguards

All private probe assets and build targets are strictly excluded via `.gitignore`:

```gitignore
# --- Private probe assets & Android build outputs ---
private-probe-assets/
private-smoke-assets/
android/app/src/privateSmoke/assets/
android/app/src/privateSmoke/res/
*.apk
```

The static scanner `scripts/verify-no-retail-assets.sh` actively asserts:
- Step 1: No `.mix`, `.csf`, `.bik`, `.vqp`, `.bag` files in Git history.
- Step 2: No probe asset directories tracked in Git index.
- Step 3: No retail files present in `android/app/src/main/assets/` or `redalert2/public/`.
- Step 4: No broad storage permissions in `AndroidManifest.xml`.
- Step 5: Clean compiled APK verification.

---

## 5. Summary & Verification Commands

```bash
# Run unit tests on privateSmoke flavor
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot"
cd android
./gradlew testPrivateSmokeDebugUnitTest

# Execute smoke probe script
bash scripts/private-smoke-probe.sh --ticks 100
```
