# Android LAN Multiplayer & Lockstep Hardening Research

**Document Version**: 1.0.0  
**Epic**: #1 Android v0.1 Port  
**Issue**: #25 [P2] Evaluate and harden LAN multiplayer for Android  
**Primary Research Paper**: [`docs/research/025-lan-multiplayer.md`](../research/025-lan-multiplayer.md)  
**Date**: 2026-08-14  

---

## 1. Research Summary

This research investigates the protocol requirements, mobile Wi-Fi latency jitter mitigation, Android multicast locking, lockstep determinism, and zero-internet origin isolation security controls needed to support **LAN Multiplayer** on Android.

---

## 2. Core Architectural Pillars

1. **Android Multicast Lock (`WifiManager.MulticastLock`)**:
   - Required to receive UDP broadcast (`port 8054`) and mDNS packets on Android Wi-Fi interfaces.
   - Native Kotlin shell acquires the lock when LAN lobby is active and releases it on `onPause()`.
2. **Adaptive Jitter Buffer Model**:
   - Compensates for mobile Wi-Fi DTIM power-save latency spikes ($150\text{ ms} - 320\text{ ms}$) using dynamic frame buffering:
     $$\text{Target Delay Frames} = \text{Base Delay (2 frames)} + \max\left(0, \left\lceil \frac{\text{Ping Jitter} - 50\text{ ms}}{33\text{ ms}} \right\rceil\right)$$
3. **Offline QR Code Peer Mesh (`LanQrPayload.ts`)**:
   - High-reliability offline connection establishment via camera QR code scanning without requiring external STUN/TURN servers or internet infrastructure.
4. **Security & Threat Defense (ADR FC-3 Compliance)**:
   - Strict origin isolation within Android WebView.
   - Remote clients cannot execute unverified map scripts; map SHA-256 must match verified local storage before loading.
   - Rolling state hash verification every 150 ticks with instant desync detection.

---

## 3. Staged Implementation Plan

- **v0.1**: Offline Single-Player & Skirmish AI focus (multiplayer disabled in release).
- **v0.2**: 1v1 QR-paired direct WebRTC LAN matches with `MulticastLock` and desync detection.
- **v0.3**: Auto-discovery LAN lobby browser via Android `NsdManager`.

*For full protocol audits, threat modeling, and mathematical proofs, see [`docs/research/025-lan-multiplayer.md`](../research/025-lan-multiplayer.md).*
