# Android Port: Build, Pack Generation & Deployment Guide

- **Document Version**: 1.0.0
- **Scope**: Step-by-step workflow for compiling web assets, extracting resource packs, assembling Android APKs, running tests, and sideloading to physical devices.

---

## 1. Quick Build (One-Command Workflow)

For automated end-to-end building, use `scripts/build-android.sh`:

```bash
# Build WebDist, stage assets, and assemble publicCi Debug APK
./scripts/build-android.sh
```

---

## 2. Step-by-Step Manual Build Process

### Step 2.1: Compile Web Game Engine
The web game engine is built using Bun/Vite:

```bash
cd redalert2
bun install # or npm install
npx vite build
cd ..
```
*Output*: Generates compiled JavaScript bundles and static HTML in `redalert2/dist/`.

### Step 2.2: Stage WebDist to Android Assets
Copy the compiled web distribution into the Android shell assets:

```bash
mkdir -p android/app/src/main/assets/WebDist
cp -R redalert2/dist/* android/app/src/main/assets/WebDist/
```

### Step 2.3: Generate Resource Pack from Retail Installation
Run `scripts/prepare-gameres.ts` pointing to your legally-owned copy of Red Alert 2 / Yuri's Revenge (e.g. Steam version):

```bash
# Set path to your retail game directory
export RA2_RETAIL_DIR="C:/Program Files (x86)/Steam/steamapps/common/Command & Conquer Red Alert II"

# Execute asset extraction and Manifest v2 generation
bun run scripts/prepare-gameres.ts
```

*Output*: Generates `gameres-export/` containing:
- Core `.mix` archives (`ra2.mix`, `language.mix`, `multi.mix`, `ra2md.mix`, etc.)
- Audio tracks converted to MP3 (`music/*.mp3`)
- Video files transcoded to WebM (`ra2ts_l.webm`)
- Extracted splash graphic (`glsl.png`)
- Cryptographically verified `manifest.json` (Manifest v2 format with SHA-256 digests)

### Step 2.4: Compile Android APK
Navigate to `android/` and invoke Gradle:

```bash
cd android

# Build Public CI Debug APK (Zero retail assets)
./gradlew assemblePublicCiDebug

# Build Private Smoke Probe Debug APK (Developer testing)
./gradlew assemblePrivateSmokeDebug
```

*APK Output*:
- `android/app/build/outputs/apk/publicCi/debug/app-publicCi-debug.apk`
- `android/app/build/outputs/apk/privateSmoke/debug/app-privateSmoke-debug.apk`

---

## 3. Running Unit Tests

Execute the full suite of automated unit tests across both TypeScript engine and Kotlin Android shell:

```bash
# 1. Run TypeScript engine tests (Bun)
cd redalert2
bun test

# 2. Run Android JVM unit tests (Gradle with JDK 21)
cd ../android
./gradlew test

# 3. Run static asset scanner to verify 0-retail leakage
cd ..
bash scripts/verify-no-retail-assets.sh
```

---

## 4. Device Deployment & Running

### Step 4.1: Enable Developer Options & USB Debugging
1. Open Android **Settings** -> **About phone** -> Tap **Build number** 7 times.
2. Go to **Settings** -> **System** -> **Developer options** -> Enable **USB debugging**.
3. Connect your Android device via USB and accept the authorization prompt.

### Step 4.2: Install APK via ADB
```bash
adb install -r android/app/build/outputs/apk/publicCi/debug/app-publicCi-debug.apk
```

### Step 4.3: Push Resource Pack to Device (SAF Selection)
Push the generated `gameres-export` directory to your device's external storage or Downloads folder:

```bash
adb push gameres-export /sdcard/Download/RA2_GameRes
```

When launching the app, use the Storage Access Framework (SAF) folder picker to select `/sdcard/Download/RA2_GameRes`. The app verifies the `manifest.json` hash digests and seeds the files into the Origin Private File System (OPFS).
