# How AI was used on this project

Three models did different jobs. This file says which, because the commit
history is authored by a human and won't tell you.

## Claude (Fable 5) — via Claude Code

The long agentic work, and most of the code in this repository: the
Swift/WKWebView shell, first-launch asset seeding, RTS touch controls,
mid-match save/load on the replay system, Yuri's Revenge support, the lighting
audit and its fixes, and the thermal pass. Also the README, the porting
playbook and this file.

## Gemini 3.6 Flash

Play-testing and translation volume.

Flash has computer use built into the API, so it could operate the game itself
rather than being handed screenshots. It drove the desktop build in a browser —
its computer use covers browser, Android and desktop environments, not iOS, so
the iPad app was never driven directly — and played skirmishes looking for
things that don't show up in a test suite. Behavioural AI bugs are the obvious
case: "the Brutal bot never builds a refinery" is invisible to assertions and
obvious to something watching a match.

It also did the source-tree translation sweep, roughly 680 lines of Chinese
across 35 files.

## GPT-5.6 Sol

The skirmish AI.

Supalosa's Chrono Divide bot was the starting point at 7,367 lines; the AI in
this repo is 11,556, so this is roughly 4,400 lines of extension rather than a
rewrite. The substantial piece is parsing the retail `aimd.ini` and wiring it in
as the attack-team library — 132 TaskForces and 165 AITriggerTypes, with trigger
conditions, per-difficulty enables and outcome weighting — plus the superweapon
officer and the per-match personality and doctrine rolls.

Some of that logic came from EA's open-sourced Red Alert 1, which the code cites
by function name (`AI_Raise_Money`, `Super_Weapon_Handler` in `HOUSE.CPP`).
Generals' skirmish pacing was read for reference but no Generals symbols appear
in the code, so treat that as background rather than a direct port.

## What none of them did

The in-game English text is not translated by any model. `scripts/setup.sh`
extracts Westwood's own English string table verbatim from your retail
`language.mix`. The translation credited above is the source tree only.

The engine itself, roughly 127,000 lines, is not AI-written. It is Chrono
Divide's, via RA2WEB and huangkaoya — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
