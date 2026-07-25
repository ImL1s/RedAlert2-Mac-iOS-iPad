/**
 * AI liveness probe — paste into the dev console of a running skirmish.
 *
 * Why this exists: three separate bugs shipped that static review missed and
 * that "no errors / good perf" soak tests also missed, because a bot that
 * silently does nothing throws nothing and costs nothing:
 *   1. Saved Brutal difficulty was demoted to Easy by the lobby sanitizer.
 *   2. A nested tick-modulus gate meant ~2/3 of bots never ran a single
 *      mission (no attacks, no garrisons, no superweapons) all game.
 *   3. A "failsafe" queued power plants as filler forever, fighting the real
 *      queue controller in a cancel loop that burned the whole economy.
 * Every one of them is caught by asserting that each bot is ALIVE in the
 * behavioural sense: thinking, building a varied base, and attacking.
 *
 * Usage:
 *   1. Start a skirmish with several AI slots at mixed difficulties
 *      (ideally 6+ bots on an 8-player map, one of each difficulty).
 *   2. Paste this file into the console.
 *   3. RA2Liveness.run()            // ~25k ticks, prints a pass/fail table
 *      RA2Liveness.run(10000)       // shorter
 *      RA2Liveness.snapshot()       // one-off look at the current state
 *
 * Runs the sim headlessly via the turn manager, so it is much faster than
 * real time and needs no rendering.
 */
(() => {
  const dd = window.__ra2debug;
  if (!dd?.game || !dd?.gameScreen?.gameTurnMgr) {
    console.error('[liveness] no game running — start a skirmish first');
    return;
  }

  // Thresholds are per difficulty and deliberately generous: they encode
  // "this bot is doing SOMETHING sane", not balance tuning. Ticks are game
  // ticks (45/s at speed 5).
  const EXPECT = {
    easy:   { byTick: 12000, minBuildings: 6, minDistinctBuildings: 4, minMissions: 3, minAttacksFormed: 1, minReach: 20 },
    normal: { byTick: 12000, minBuildings: 8, minDistinctBuildings: 5, minMissions: 4, minAttacksFormed: 2, minReach: 30 },
    brutal: { byTick: 12000, minBuildings: 8, minDistinctBuildings: 5, minMissions: 4, minAttacksFormed: 2, minReach: 30 },
  };
  // Any single structure beyond this is spam (the power-plant/bio-reactor
  // failure mode). Base defenses are excluded — walls of Tesla Coils are a
  // legitimate turtle strategy.
  const MAX_COPIES_NON_DEFENSE = 8;
  // Repeated "Cancelling ready X" means something is queueing behind the
  // queue controller's back.
  const MAX_CANCELS = 3;

  // Cumulative across the run: _debugMessages is only a 20-entry ring, so
  // counting "launched" log lines undercounts badly (it reported a brutal bot
  // as never attacking while it had four attack missions in the field).
  // Instead accumulate the distinct attack-mission names ever observed.
  const attacksSeen = new Map();

  const snapshot = () => {
    const g = dd.game;
    const rows = [];
    for (const bot of g.botManager.bots.values()) {
      const inner = bot.innerBot;
      const cfg = inner?.strategy?.config;
      const player = g.getPlayerByName(bot.name);
      const objects = player.getOwnedObjects();
      const buildings = objects.filter((o) => o.isBuilding?.());
      const hist = {};
      buildings.forEach((o) => { hist[o.name] = (hist[o.name] ?? 0) + 1; });
      const worstNonDefense = Object.entries(hist)
        .filter(([name]) => {
          const sample = buildings.find((o) => o.name === name);
          return !sample?.rules?.isBaseDefense;
        })
        .sort((a, b) => b[1] - a[1])[0] ?? ['-', 0];
      const missions = inner.missionController.getMissions();
      const missionList = Array.isArray(missions) ? missions : [...(missions?.values?.() ?? [])];
      const msgs = inner._debugMessages ?? [];
      const power = player.powerTrait;

      const seen = attacksSeen.get(bot.name) ?? new Set();
      missionList
        .map((m) => m.getUniqueName?.() ?? '')
        .filter((n) => n.startsWith('attack'))
        .forEach((n) => seen.add(n));
      attacksSeen.set(bot.name, seen);

      // Force projection: units far from the start position mean the bot is
      // actually pushing out, not just cycling missions at home.
      const start = player.startLocation;
      const farthestUnit = objects
        .filter((o) => !o.isBuilding?.() && o.tile)
        .reduce((max, o) => Math.max(max, Math.hypot(o.tile.rx - (start?.x ?? 0), o.tile.ry - (start?.y ?? 0))), 0);
      rows.push({
        name: bot.name.replace(/@/g, ''),
        difficulty: cfg?.difficultyId,
        personality: cfg?.personalityId,
        doctrine: cfg?.matchDoctrine?.doctrine?.id,
        defeated: !!player.defeated,
        buildings: buildings.length,
        distinctBuildings: Object.keys(hist).length,
        units: objects.length - buildings.length,
        worstStructure: `${worstNonDefense[0]}x${worstNonDefense[1]}`,
        worstStructureCount: worstNonDefense[1],
        power: `${power?.power ?? 0}/${power?.drain ?? 0}`,
        missions: missionList.length,
        attacksFormed: seen.size,
        farthestUnit: Math.round(farthestUnit),
        cancels: msgs.filter((m) => /Cancelling ready/.test(m)).length,
      });
    }
    return rows;
  };

  const run = (ticks = 25000, chunk = 2500) => {
    const tm = dd.gameScreen.gameTurnMgr;
    const errors = [];
    const origError = console.error.bind(console);
    console.error = (...args) => { errors.push(args.map((a) => String(a?.message ?? a)).join(' ')); origError(...args); };

    let stamp = performance.now();
    let done = 0;
    let cost = 0;
    const startTick = dd.game.currentTick;
    while (done < ticks && dd.game) {
      const t0 = performance.now();
      for (let i = 0; i < chunk && done < ticks && dd.game; i++, done++) {
        stamp += tm.getTurnMillis();
        tm.doGameTurn(stamp);
      }
      cost += performance.now() - t0;
    }
    console.error = origError;

    const rows = snapshot();
    const tick = dd.game?.currentTick ?? startTick + done;
    const results = rows.map((r) => {
      const bar = EXPECT[r.difficulty] ?? EXPECT.normal;
      const failures = [];
      // A bot killed by another bot is a legitimate outcome, not a failure.
      if (!r.defeated && tick >= bar.byTick) {
        if (r.buildings < bar.minBuildings) failures.push(`only ${r.buildings} buildings`);
        if (r.distinctBuildings < bar.minDistinctBuildings) failures.push(`only ${r.distinctBuildings} distinct structures`);
        if (r.missions < bar.minMissions) failures.push(`only ${r.missions} missions (bot may not be thinking)`);
        if (r.attacksFormed < bar.minAttacksFormed) failures.push(`only ${r.attacksFormed} attack missions ever formed`);
        if (r.farthestUnit < bar.minReach) failures.push(`army never left home (max reach ${r.farthestUnit} tiles)`);
      }
      if (r.worstStructureCount > MAX_COPIES_NON_DEFENSE) failures.push(`structure spam: ${r.worstStructure}`);
      if (r.cancels > MAX_CANCELS) failures.push(`${r.cancels} queue cancels (something is queueing behind the controller)`);
      return { ...r, verdict: failures.length ? 'FAIL' : 'pass', failures: failures.join('; ') };
    });

    console.table(results.map((r) => ({
      bot: r.name, difficulty: r.difficulty, personality: r.personality, doctrine: r.doctrine,
      bld: r.buildings, distinct: r.distinctBuildings, units: r.units, power: r.power,
      missions: r.missions, attacks: r.attacksFormed, reach: r.farthestUnit, worst: r.worstStructure,
      dead: r.defeated ? 'yes' : '', verdict: r.verdict, why: r.failures,
    })));

    const identities = new Set(results.map((r) => `${r.personality}:${r.doctrine}`));
    const failed = results.filter((r) => r.verdict === 'FAIL');
    console.log(`[liveness] tick ${tick}, ${(cost / Math.max(1, done)).toFixed(3)} ms/tick, ` +
      `${identities.size}/${results.length} distinct personality+doctrine, ${errors.length} console errors`);
    if (errors.length) console.log('[liveness] errors:', errors.slice(0, 10));
    console.log(failed.length ? `[liveness] ❌ ${failed.length} bot(s) FAILED` : '[liveness] ✅ all bots alive and acting');
    return { tick, msPerTick: +(cost / Math.max(1, done)).toFixed(3), errors, results, pass: failed.length === 0 };
  };

  window.RA2Liveness = { run, snapshot };
  console.log('[liveness] ready — RA2Liveness.run() or RA2Liveness.snapshot()');
})();
