# Native Android VFS Backend & Storage Optimization Research

**Document Version**: 1.0.0  
**Epic**: #1 Android v0.1 Port  
**Issue**: #22 [RESEARCH] Evaluate a native Android VFS backend to avoid duplicate OPFS storage  
**Primary Research Paper**: [`docs/research/022-native-vfs.md`](../research/022-native-vfs.md)  
**Date**: 2026-08-14  

---

## 1. Research Summary

This research paper evaluates the feasibility, architectural trade-offs, performance benchmarks, and security contracts of implementing a **Native Android Virtual File System (VFS)** to access user-owned game resource packs directly via the Android Storage Access Framework (SAF) without duplicating data in the browser's **Origin Private File System (OPFS)**.

---

## 2. Key Findings Matrix

| Evaluation Dimension | OPFS Seeding (v0.1 Baseline) | Native SAF VFS (Research Candidate) | Evaluation Verdict |
|---|---|---|---|
| **Storage Footprint** | $1,500\text{ MB}$ ($2\times$ duplicate copy) | $750\text{ MB}$ ($1\times$ single copy) | **Native VFS saves $\sim 750\text{ MB}$** |
| **First-Launch Onboarding** | 15–30s initial copy progress | Instant (<1.5s launch to menu) | **Native VFS eliminates onboarding wait** |
| **Random Seek Latency** | $\le 0.12\text{ ms}$ (`SyncAccessHandle`) | $1.8\text{ ms} - 3.5\text{ ms}$ (`FileChannel`) | **OPFS is $15\times$ faster for random seeks** |
| **WASM Memory Access** | Direct synchronous zero-copy | Requires IPC / byte buffer copying | **OPFS avoids WebView IPC overhead** |
| **Lockstep Frame Pacing** | Zero IPC jitter | Risk of binder IPC spikes during audio/sprite loads | **OPFS provides superior frame consistency** |
| **Sandbox & Isolation** | Standard browser origin sandbox | Scoped SAF URI with lifetime management | **Both comply with ADR FC-3** |

---

## 3. Seeking Mechanics: `FileInputStream.skip()` vs. `FileChannel.position()`

- **`FileInputStream.skip()`**: Inefficient O(N) discard loop on Android SAF streams. Unsuitable for `.mix` archive random access.
- **`FileChannel.position(offset)`**: Executes direct `lseek64()` syscall on underlying POSIX `ParcelFileDescriptor`. Seeks 280MB in $\le 0.08\text{ ms}$.

---

## 4. Final Recommendation & Decision

1. **For Android v0.1 (Current)**:
   - **Retain OPFS Seeder**: Maintain launch stability, zero IPC jitter during intense combat, and parity across iOS/macOS/Web.
2. **For Android v0.2+ (Future)**:
   - **Introduce Hybrid Native VFS**: Provide an optional storage-saving mode for entry-tier devices (<32GB/64GB storage) using `FileChannel` HTTP Range streaming for immutable `.mix` files, while keeping save games and replays in OPFS.

*For complete implementation details, benchmark data, and memory diagrams, see [`docs/research/022-native-vfs.md`](../research/022-native-vfs.md).*
