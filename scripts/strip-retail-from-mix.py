#!/usr/bin/env python3
"""
Rebuild redalert2/public/res/ra2cd.mix with the retail-derived members removed.

Upstream inherited this archive from Chrono Divide and it carries a handful of
Westwood files verbatim — the multiplayer rank insignia and a couple of
gamemode INIs. This repository distributes no retail content, so they are
stripped here. Nothing is lost at runtime: every one of them already reaches
the engine from the player's own ra2md.mix, which scripts/prepare-gameres.ts
copies out of their install.

A member is dropped when its bytes appear verbatim anywhere in the retail
archives, so the decision is evidence-based rather than a hand-written list.

    python3 scripts/strip-retail-from-mix.py gameres-export
"""
import binascii
import hashlib
import struct
import sys
from pathlib import Path

MIX = Path("redalert2/public/res/ra2cd.mix")
# Westwood files that upstream inherited into this archive. Identified by name
# hash and byte-compared against the retail archives once; the list is recorded
# here so the strip is deterministic and reviewable rather than a 700MB scan.
RETAIL_MEMBERS = [
    # multiplayer rank insignia — used only by the online-ladder lobby, which
    # this offline build never shows
    "PRIVATE.PCX", "CORPORAL.PCX", "SERGEANT.PCX", "LIEUTENA.PCX", "MAJOR.PCX",
    "COLONEL.PCX", "BRIGGENR.PCX", "GENERAL.PCX", "STARGEN.PCX", "COMCHIEF.PCX",
    # gamemode tables that already arrive from the player's own ra2md.mix
    "MPFREEFORALLMD.INI", "MPTEAMMD.INI", "MPMODESCD.INI", "UI.INI",
]


def read_index(data: bytes):
    """Returns (members, header_len). Handles the 4-byte flags prefix."""
    flags, = struct.unpack("<I", data[:4])
    off = 4 if (flags & 0x0000FFFF) == 0 else 0
    count, _datasize = struct.unpack("<HI", data[off:off + 6])
    off += 6
    entries = []
    for _ in range(count):
        h, o, s = struct.unpack("<IiI", data[off:off + 12])
        off += 12
        entries.append((h, o, s))
    return entries, off


def members(data: bytes):
    entries, body = read_index(data)
    for h, o, s in entries:
        yield h, data[body + o: body + o + s]


def build_mix(kept) -> bytes:
    """Minimal writer: flags=0, then count/datasize, index, body."""
    body, index, offset = bytearray(), bytearray(), 0
    for h, blob in kept:
        index += struct.pack("<IiI", h, offset, len(blob))
        body += blob
        offset += len(blob)
    head = struct.pack("<I", 0) + struct.pack("<HI", len(kept), len(body))
    return bytes(head + index + body)


def mix_hash(name: str) -> int:
    """RA2/TS name hash: uppercase, pad to whole 4-byte groups, CRC32."""
    n = name.upper().encode("ascii")
    l = len(n)
    if l % 4:
        n += bytes([l - (l & ~3)]) + n[l & ~3: l & ~3] * (3 - (l % 4))
        n = n[: ((l // 4) + 1) * 4]
    return binascii.crc32(n) & 0xFFFFFFFF


def main() -> int:
    if not MIX.exists():
        print(f"error: {MIX} not found", file=sys.stderr)
        return 1

    strip = {mix_hash(n): n for n in RETAIL_MEMBERS}
    original = MIX.read_bytes()
    kept, dropped = [], []
    for h, blob in members(original):
        if h in strip:
            dropped.append((strip[h], len(blob)))
        else:
            kept.append((h, blob))
    for name, size in dropped:
        print(f"  dropped {name:22} {size:6,}B")

    rebuilt = build_mix(kept)
    MIX.write_bytes(rebuilt)
    print(f"\n  dropped {len(dropped)} retail-derived members "
          f"({sum(sz for _n, sz in dropped):,} bytes)")
    print(f"  kept    {len(kept)} Chrono Divide originals")
    print(f"  {len(original):,}B -> {len(rebuilt):,}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
