# Android Port: Troubleshooting & FAQ

- **Document Version**: 1.0.0
- **Scope**: Diagnostic solutions for common build errors, runtime crashes, WebView issues, and storage authorization edge cases.

---

## 1. Build & Compilation Issues

### 1.1 "No matching variant of com.android.tools.build:gradle:8.2.2 was found (Java 8 vs Java 11/17/21)"
- **Cause**: Gradle Daemon launched using an outdated Java 8 runtime instead of JDK 17/21.
- **Fix**: Set `JAVA_HOME` pointing to JDK 21 before invoking Gradle:
  ```powershell
  $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot"
  cd android
  .\gradlew --stop
  .\gradlew test
  ```

### 1.2 "compileSdk = 35 warning in Android Gradle Plugin 8.2.2"
- **Cause**: AGP 8.2.2 was tested against API 34; API 35 triggers an informational warning.
- **Fix**: The warning is harmless. To suppress it, add `android.suppressUnsupportedCompileSdk=35` to `android/gradle.properties`.

### 1.3 "ffmpeg: command not found during prepare-gameres.ts"
- **Cause**: FFmpeg is required to convert `.wav` to `.mp3` and `.bik` to `.webm`.
- **Fix**: Install FFmpeg and add it to system `PATH` (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`).

---

## 2. Storage & SAF Onboarding Issues

### 2.1 "Manifest verification failed / Checksum mismatch"
- **Cause**: A retail asset was modified, incomplete, or corrupted during copying.
- **Fix**:
  1. Re-run `bun run scripts/prepare-gameres.ts` on a clean, validated retail installation.
  2. Verify that `gameres-export/manifest.json` contains valid SHA-256 hashes and version `2`.
  3. Re-push the folder to your device via `adb push gameres-export /sdcard/Download/RA2_GameRes`.

### 2.2 "SAF folder permission revoked after device reboot"
- **Cause**: Persisted URI permissions were cleared by system settings or app uninstalled.
- **Fix**: Tap **Select Resource Pack** on the home screen to grant folder access again. The app automatically persists the grant via `takePersistableUriPermission`.

### 2.3 "Out of Storage during OPFS Seeding"
- **Cause**: Device has insufficient internal storage space for the 750MB game assets.
- **Fix**: Free up at least 1.5GB of internal storage (the preflight check requires 1.1x safety margin above total pack size).

---

## 3. WebView & Rendering Issues

### 3.1 "Black screen on launch / WebGL context lost"
- **Cause**: Outdated Android System WebView on emulator or physical device.
- **Fix**: Update **Android System WebView** or **Google Chrome** from the Play Store on the device to version 110+.

### 3.2 "Renderer process crashed (onRenderProcessGone)"
- **Cause**: System killed WebView renderer due to OOM (Out Of Memory) or GPU driver crash.
- **Fix**: The shell automatically handles recovery via the FC-5 destroy+recreate loop (up to 3 retries in 5 minutes). If the crash is persistent, check `adb logcat -s chromium,DEBUG,WebViewHost` for memory leaks.

---

## 4. Diagnostics & Log Collection

To capture full logs during debugging:

```bash
# Filter Android shell logs
adb logcat -s RA2Android:V WebViewHost:V LocalContentWebViewClient:V Chromium:W

# Check Chrome DevTools remote inspection
# 1. Open chrome://inspect in desktop Google Chrome
# 2. Select the "Red Alert 2" WebView instance
# 3. Inspect console logs, network requests, and OPFS storage
```
