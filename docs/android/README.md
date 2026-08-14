# Red Alert 2 & Yuri's Revenge — Android Port

Welcome to the Android port documentation for Red Alert 2 & Yuri's Revenge. This native Android implementation hosts the deterministic TypeScript engine inside a secured Android `WebView` shell with Storage Access Framework (SAF) resource onboarding.

---

## 📚 Documentation Index

- **[SETUP.md](SETUP.md)**: Prerequisites, JDK 21 installation, Android SDK setup, and environment variables.
- **[BUILD.md](BUILD.md)**: One-command build instructions, resource pack generation via `scripts/prepare-gameres.ts`, device deployment, and unit test execution.
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**: Solutions for common build issues, runtime errors, WebView rendering caveats, and SAF storage troubleshooting.
- **[ADR-001 Architecture Baseline](../adr/001-android-architecture.md)**: Architectural decisions, fail-closed security invariants FC-1 through FC-6, and storage contracts.
- **[LICENSING_AND_PROVENANCE.md](LICENSING_AND_PROVENANCE.md)**: Legal provenance framework and `PUBLIC_RELEASE_BLOCKED = true` release gate.
- **[PRIVATE_PROBE.md](PRIVATE_PROBE.md)**: Developer local embedded-resource smoke testing guide.

---

## 🚀 Quickstart

```bash
# 1. Build the web engine
cd redalert2
bun install
npx vite build
cd ..

# 2. Extract game resources from your legally-owned retail install
export RA2_RETAIL_DIR="/path/to/your/steam/ra2"
bun run scripts/prepare-gameres.ts

# 3. Build and install Android debug APK
export JAVA_HOME="/path/to/jdk-21"
cd android
./gradlew assemblePublicCiDebug
adb install app/build/outputs/apk/publicCi/debug/app-publicCi-debug.apk
```

---

## 🏛️ System Architecture

```
                      +------------------------------------------+
                      |          Android Kotlin Shell            |
                      |               (android/)                 |
                      |                                          |
                      |  - MainActivity.kt (Lifecycle / Back)    |
                      |  - WebViewHost.kt (Renderer Recovery)    |
                      |  - LocalContentWebViewClient.kt          |
                      |  - SafResourcePackManager.kt (SAF v2)    |
                      +--------------------+---------------------+
                                           |
                                Local Scheme Router
                      https://appassets.androidplatform.net/
                                           |
                      +--------------------v---------------------+
                      |        TypeScript Web Game Engine        |
                      |              (redalert2/)                |
                      |                                          |
                      |  - nativeBridge.ts / nativeLifecycle     |
                      |  - OPFS Storage (navigator.storage)      |
                      |  - Three.js WebGL Simulation Renderer    |
                      +------------------------------------------+
```
