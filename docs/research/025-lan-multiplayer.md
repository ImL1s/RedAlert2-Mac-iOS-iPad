# Research & Hardening Report #025: Android LAN Multiplayer & Lockstep Hardening

**Project**: RedAlert2 Android Port (`ImL1s/RedAlert2-Android-iOS-iPad`)  
**Document ID**: RR-025-LAN  
**Status**: Completed / Evaluated (P2 Post-v0.1 Roadmap)  
**Date**: 2026-08-14  
**Author**: Worker Wave 4  

---

## 1. Executive Summary & Objective

This report evaluates the networking, lockstep determinism, peer discovery, mobile power-saving latency jitter, and origin isolation security constraints required to support **LAN Multiplayer** on the Red Alert 2 Android port.

### Core Objectives
1. Map and audit existing LAN modules (`LanLockstepTurnManager`, `LanMeshSession`, `LanRoomSession`, `LanQrPayload`).
2. Solve Android Wi-Fi multicast constraints (`WifiManager.MulticastLock` and `NsdManager`).
3. Formulate an adaptive lockstep jitter buffer model resilient to mobile Wi-Fi power-save sleep spikes (DTIM 3/4).
4. Threat-model untrusted LAN peers and enforce strict zero-internet WebView origin isolation (ADR FC-3).
5. Define a staged implementation plan for safe multiplayer deployment.

---

## 2. Existing LAN Architecture & Engine Inventory

The game engine (`redalert2/src/network/lan/`) provides a clean WebRTC/WebSocket-based peer mesh:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LanRoomSession.ts                               │
│  - Player slot assignment (Host / Client)                              │
│  - Map selection & SHA-256 digest validation                           │
├────────────────────────────────────────────────────────────────────────┤
│                       LanLockstepTurnManager.ts                        │
│  - Turn frame packet exchange (Orders, Acks, Checksums)                │
│  - Rolling state hash verification (Desync detection)                  │
├────────────────────────────────────────────────────────────────────────┤
│             LanMeshSession.ts  /  LanQrPayload.ts                      │
│  - WebRTC DataChannel transport (RTCDataChannel, SCTP)                 │
│  - Offline QR Code pairing (Zero-signaling fallback)                   │
└────────────────────────────────────────────────────────────────────────┘
```

### Module Audit Findings
- **`LanLockstepTurnManager.ts`**: Ticks at fixed intervals (typically 30 TPS or 15 TPS). Every client broadcasts unit order packets and state hashes. Execution only advances when all connected peers acknowledge the frame.
- **`LanQrPayload.ts`**: Provides camera-based SDP/ICE candidate exchange via QR code scanning. This enables two mobile devices in an offline environment (e.g. Wi-Fi hotspot without internet) to establish a direct WebRTC peer connection with zero external STUN/TURN servers.
- **`LanRoomSession.ts`**: Transmits map name and CRC. Requires hardening to ensure clients only play maps present in their verified local resource pack.

---

## 3. Android Mobile Wi-Fi & Discovery Realities

### 3.1 Multicast Packet Filtering & `MulticastLock`
By default, the Android Linux kernel filters out broadcast and multicast UDP packets to conserve battery when the device is connected to Wi-Fi.
- **The Problem**: Standard mDNS discovery (`_ra2-lan._tcp.local.`) and UDP broadcast on port `8054` fail silently on Android unless multicast reception is explicitly unlocked.
- **Native Android Shell Solution**:
  ```kotlin
  val wifiManager = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
  val multicastLock = wifiManager.createMulticastLock("RA2_LAN_MULTICAST_LOCK").apply {
      setReferenceCounted(true)
      acquire()
  }
  // Released in onPause() / onDestroy()
  ```

### 3.2 Peer Discovery Options Matrix

| Discovery Method | Android OS Dependency | Internet / Infrastructure Required | Reliability / User Friction |
|---|---|:---:|---|
| **Android NSD (`NsdManager` / mDNS)** | Native Android API (API 28+) | Local Wi-Fi Router | High (Auto-discovers hosts on same subnet) |
| **UDP Subnet Broadcast (`255.255.255.255:8054`)** | Requires `MulticastLock` | Local Wi-Fi Router | Medium (Some mobile hotspots block broadcast) |
| **Offline QR Code Scanning (`LanQrPayload.ts`)**| Camera Permission | **Zero (Works on direct Mobile Hotspot)** | **Very High (100% offline, zero network dependencies)** |
| **Manual IP Input (`192.168.x.x:8054`)** | None | Local Wi-Fi Router | 100% reliable fallback for power users |

---

## 4. Mobile Wi-Fi Latency Pacing & Jitter Buffer Formulation

### 4.1 The Mobile Wi-Fi Power-Save Problem (DTIM)
Mobile chipsets sleep their Wi-Fi radios between beacon frames (Delivery Traffic Indication Message, DTIM 3/4 intervals, $\sim 300\text{ ms}$). This causes periodic latency spikes:
- Standard desktop ping: $2\text{ ms} - 10\text{ ms}$.
- Android mobile Wi-Fi ping: $5\text{ ms}$ nominal with periodic jumps to **$150\text{ ms} - 320\text{ ms}$**.

### 4.2 Adaptive Jitter Buffer Formulation
To prevent jerky game stutter when a mobile peer experiences a DTIM power-save spike, the lockstep turn manager must dynamically buffer order execution:

$$\text{Target Delay Frames} = \text{Base Delay (2 frames)} + \max\left(0, \left\lceil \frac{\text{Measured Jitter} - 50\text{ ms}}{33\text{ ms}} \right\rceil\right)$$

- At nominal Wi-Fi latency ($<50\text{ ms}$): Delay is **2 frames** ($66\text{ ms}$).
- During Wi-Fi power-save spike ($200\text{ ms}$ jitter): Delay automatically adjusts to **$2 + \lceil 150/33 \rceil = 7\text{ frames}$** ($231\text{ ms}$), smoothly absorbing the burst without halting simulation.

---

## 5. Security & Origin Isolation Hardening (ADR FC-3 Compliance)

### 5.1 Threat Modeling Untrusted LAN Peers
In a public Wi-Fi or LAN environment, malicious actors could attempt:
1. *Malformed Map / Mod Injection*: Sending custom scripts or oversized `.map` files designed to exploit parser memory vulnerabilities.
2. *State Desync Flooding*: Sending false order packets to corrupt other players' simulation state.
3. *Network Origin Escape*: Using LAN signaling to trigger external HTTP connections inside the WebView.

### 5.2 Mandatory Hardening Controls
1. **Zero-Internet Origin Gate (ADR FC-3)**: The Android WebView operates strictly with `allowFileAccess=false`, `allowContentAccess=false`, and `MIXED_CONTENT_NEVER_ALLOW`. No connections to external WAN endpoints are permitted.
2. **Local Map Integrity Verification**: Remote clients cannot force a host to download arbitrary map files over LAN. Map CRC/SHA-256 must exist in the local verified resource pack (`gameres/`) or fail closed before match start.
3. **Rolling State Digest & Desync Detection**:
   - Every 150 simulation ticks (5 seconds), all clients compute a cryptographic state checksum:
     $$\text{StateHash} = \text{CRC32}(\text{Units} \mathbin{\Vert} \text{Buildings} \mathbin{\Vert} \text{Credits} \mathbin{\Vert} \text{RNG Seed})$$
   - If any client hash differs, the match pauses immediately with a *"Game Out of Sync"* dialog and saves a synchronized replay dump for diagnostic review.

---

## 6. Lifecycle & Interruption Handling

1. **Incoming Phone Call / Backgrounding**:
   - If an Android peer receives a phone call, `Activity.onPause()` fires.
   - The lockstep engine grants a **5.0-second grace window**.
   - If the player resumes within 5 seconds, the peer fast-forwards buffered turns.
   - If unresumed after 5 seconds, the match safely drops the disconnected player, surrendering their units to AI/neutral without crashing other participants.

---

## 7. Staged Implementation Roadmap

```
Phase 1 (v0.1 - Current Baseline):
  └── Focus entirely on rock-solid offline Single-Player & Skirmish AI (Issues #1-#24).
  └── LAN multiplayer disabled in user-facing UI.

Phase 2 (v0.2 - Local Peer Mesh):
  ├── Enable QR Code visual pairing (LanQrPayload.ts) for 1v1 direct mobile hotspot matches.
  ├── Wire WifiManager.MulticastLock in Kotlin MainActivity.kt.
  └── Enforce rolling StateHash desync detection and map SHA-256 pre-check.

Phase 3 (v0.3 - Full LAN Lobby):
  ├── Integrate NsdManager native service discovery.
  └── Add 4-8 player local LAN lobby browser.
```

---

## 8. Conclusion

LAN multiplayer on Android is structurally sound due to the existing WebRTC `LanMeshSession` and offline QR pairing architecture. By acquiring `WifiManager.MulticastLock`, implementing the adaptive jitter buffer formula, and enforcing strict local map verification, Android LAN multiplayer will provide an exceptional local experience in v0.2 without compromising the v0.1 zero-internet security invariant.
