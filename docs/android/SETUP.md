# Android Port: Developer Environment Setup

- **Document Version**: 1.0.0
- **Target Platform**: Android API 29 (Android 10) to API 35 (Android 15)
- **Host Systems**: Windows 10/11 (PowerShell / WSL), macOS (ARM64 / Intel), Linux (x86_64)

---

## 1. Prerequisites

Ensure the following toolchains are installed on your workstation:

### 1.1 Java Development Kit (JDK 21)
Android Gradle Plugin 8.2.2+ requires **JDK 17 or JDK 21**. We recommend **Eclipse Adoptium Temurin 21**:
- **Windows**: `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot` (or install via `winget install EclipseAdoptium.Temurin.21.JDK`)
- **macOS**: `brew install openjdk@21`
- **Linux**: `sudo apt install openjdk-21-jdk`

### 1.2 Android SDK & Command-Line Tools
- **Compile SDK**: API 35 (Android 15)
- **Target SDK**: API 35
- **Minimum SDK**: API 29 (Android 10)
- **Build Tools**: `35.0.0`
- **Android NDK**: Optional (not required for Kotlin/WebView shell)
- **Android Emulator / Physical Device**: USB Debugging enabled, Android 10+.

### 1.3 JavaScript & TypeScript Runtime
- **Bun**: `bun v1.3+` (recommended for fastest test execution and asset scripts)
- **Node.js**: Node 18+ or 20+ with npm / npx

### 1.4 Media Transcoder
- **FFmpeg**: Required for audio (WAV -> MP3) and video (BIK -> WebM) extraction in `scripts/prepare-gameres.ts`.
  - Windows: `winget install Gyan.FFmpeg` or download from <https://ffmpeg.org/>
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

---

## 2. Environment Variables Configuration

Set `JAVA_HOME` and `ANDROID_HOME` in your environment:

### PowerShell (Windows)
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

### Bash / Zsh (macOS / Linux)
```bash
export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" # macOS
# export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64" # Linux
export ANDROID_HOME="$HOME/Library/Android/sdk" # macOS
# export ANDROID_HOME="$HOME/Android/Sdk" # Linux
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

---

## 3. Verifying Your Setup

Run the following commands in the project root to verify your environment:

```bash
# Verify Java version
java -version
# Expected: openjdk version "21.x.x"

# Verify Bun
bun --version
# Expected: 1.x.x

# Verify Android ADB
adb version
# Expected: Android Debug Bridge version 1.0.x

# Verify FFmpeg
ffmpeg -version
```
