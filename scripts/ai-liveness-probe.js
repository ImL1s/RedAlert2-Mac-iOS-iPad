/**
 * RA2 AI LIVENESS HARNESS (v2) — paste into the dev console of a running skirmish.
 *
 * WHY THIS EXISTS
 * Three regressions shipped that static review, "no console errors" soaks and
 * frame-rate profiling all missed, because a bot that silently does NOTHING
 * throws nothing and costs nothing:
 *   1. PregameController.sanitizeLastBotSettings clamped Brutal (enum 0) to
 *      Easy, so the lobby said Brutal and the bot ran the easy profile.
 *   2. bot.ts gated missions on `tick % 3` inside an update that only runs on
 *      `(tick + phaseOffset) % tickRatio === 0`. For most phase offsets the two
 *      conditions are mathematically incompatible: those bots NEVER ran
 *      missions, strategy or superweapons for the whole match.
 *   3. baseBuildingMission floored the priority of an in-production structure
 *      at 1, so a capped structure was re-requested the instant it completed —
 *      an endless queue/cancel loop that produced 7 power plants and no army.
 *
 * Every one of those is a LIVENESS failure, so this harness asserts liveness
 * directly and from the inside:
 *   - the lobby difficulty each bot was given == the profile it actually runs
 *   - BuiltInBot.onGameTick fires at the profile's cadence (apm -> tickRatio)
 *   - MissionController.onAiUpdate fires at 1/3 of that cadence (the dead gate)
 *   - QueueController.onAiUpdate fires every bot update
 *   - DefaultStrategy lazily built its AttackMissionFactory
 *   - AttackMissionFactory.waveIndex actually increments (waves LAUNCH), with
 *     gaps bounded by that bot's own visibleTargetCooldownTicks/launchTimeout
 *   - the base grows, is varied, and no single structure exceeds its code cap
 *   - "Cancelling ready X" / "Dequeueing queue" stay inside a sane budget
 *   - the army peaks above a floor, harvesters exist, power is not chronically low
 *   - nothing in the AI call graph touched Math.random / Date.now (lockstep)
 *   - per-bot AI cost stays under the 1 ms/tick device budget
 *
 * It counts from INSTRUMENTATION, never from `_debugMessages` (a 20-entry ring
 * that silently undercounts) and never from sampled mission lists alone.
 *
 * USAGE
 *   1. Start a skirmish with 5-7 AI slots at MIXED difficulties (at least one
 *      Easy, one Normal, one Brutal) on an 8-player map. Start it at tick 0 —
 *      the invariants are absolute-tick based.
 *   2. Paste this file into the console.
 *   3. await RA2Liveness.run()             // 25k ticks, prints a pass/fail table
 *      await RA2Liveness.run({ ticks: 12000 })
 *      RA2Liveness.snapshot()              // one-off read, no simulation
 *      RA2Liveness.help()
 *
 * The harness takes ownership of the turn clock (it neutralises the rAF driver
 * for the duration) so ticks are stepped as fast as the CPU allows and the
 * ms/tick number is meaningful. Everything it patches is restored in a
 * `finally`, including on exception.
 *
 * WHERE THIS IS CHECKED IN — RUN IT BEFORE EVERY DEVICE BUILD
 *   scripts/build-ios.sh prints a reminder and refuses `--device` unless
 *   RA2_LIVENESS_OK=1 is exported. The gate is manual on purpose: the harness
 *   needs a real WebGL context and the game resources, so it runs in the
 *   desktop lab, not in CI. Procedure:
 *     1. cd redalert2 && bun --bun vite dev
 *     2. Skirmish -> 8-player map -> 6 AI slots: 2 Easy, 2 Normal, 2 Brutal.
 *     3. Start, open the console, paste this file, `await RA2Liveness.run()`.
 *     4. Every row must read `pass`, and the footer must read PASS.
 *     5. Only then: RA2_LIVENESS_OK=1 ./scripts/build-ios.sh --device
 *   Add the printed footer line to the commit message of any AI change.
 */
(() => {
  'use strict';

  const HARNESS_VERSION = '2.0';

  // ---------------------------------------------------------------------------
  // Thresholds. Every number below is derived from the shipping code, not taste.
  // ---------------------------------------------------------------------------

  // game/gameopts/GameOpts.ts:4  -> game/bot/BotFactory.ts:43-56
  const DIFFICULTY_BY_ENUM = {
    0: 'brutal', 1: 'dummy', 2: 'easy', 3: 'dummy', 4: 'normal', 5: 'custom',
  };

  // Invariants that need a mature base/army are only judged from this tick on.
  // Justification: easy's first attack is gated at
  // firstAttackDelaySeconds(<=240, botProfiles.ts:226) * TICKS_PER_SECOND(15,
  // attackMission.ts:132) = 3600 ticks, plus a launch timeout of <=1800
  // (botProfiles.ts:237) and a launch cooldown of <=1500
  // (attackMission.ts:444). 12000 ticks leaves >2x slack over the slowest
  // legal difficulty x personality combination.
  const EVAL_TICK = 12000;

  const EXPECT = {
    easy: {
      // DEFENSE_CAP_BY_DIFFICULTY / EXTRA_REFINERIES_BY_DIFFICULTY /
      // SLAVE_MINERS_BY_DIFFICULTY, baseBuildingMission.ts:37-39
      defenseCap: 6, refineryCap: 1, slaveCap: 2,
      // A bot that built a conyard, power, barracks, refinery, war factory and
      // one more thing is alive; anything less is a stalled build order.
      minBuildings: 6, minDistinct: 4,
      // armySizeMultiplier 0.6 x personality (botProfiles.ts:26) over the
      // default compositions' minimumUnits 2-3 (defaultStrategy.ts:26-50).
      minPeakArmy: 5,
      // (EVAL_TICK - 3600 first-attack gate) / 1800 worst-case wave period
      // = 4.6 waves; require 2 for >2x slack.
      minLaunches: 2,
      // 3600 gate + 1800 launch timeout + 1800 slack.
      firstLaunchBy: 7200,
    },
    normal: {
      defenseCap: 20, refineryCap: 2, slaveCap: 3,
      minBuildings: 8, minDistinct: 5,
      minPeakArmy: 9,
      // firstAttackDelaySeconds 0 (botProfiles.ts:36); cooldown <=1275
      // (750 x turtle 1.7 clamped by Math.min(1500,...)); timeout <=2400.
      // 12000 / 2400 = 5 waves; require 3.
      minLaunches: 3,
      firstLaunchBy: 4500,
    },
    brutal: {
      defenseCap: 25, refineryCap: 3, slaveCap: 4,
      minBuildings: 9, minDistinct: 6,
      // armySizeMultiplier 1.5 x personality (botProfiles.ts:42).
      minPeakArmy: 13,
      // launch gate 600 (attackMission.ts:387) x <=1.7 = 1020; timeout <=2400.
      minLaunches: 3,
      firstLaunchBy: 4000,
    },
  };

  // baseBuildingMission.ts:44 SAME_STRUCTURE_HARD_CAP, powerPlant.ts:8
  // ABSOLUTE_MAX_PLANTS. Caps are enforced on build priority, so a copy may
  // land after the check; +1 of slack, no more.
  const SAME_STRUCTURE_HARD_CAP = 8;
  const POWER_PLANT_CAP = 16;
  const CAP_SLACK = 1;

  // Queue churn budgets, per 10k ticks. The regression printed hundreds of
  // "Cancelling ready NAPOWR"; legitimate cancels come from placement failure
  // and are rare.
  const CANCELS_PER_NAME_PER_10K = 6;
  const CANCELS_TOTAL_PER_10K = 25;
  const DEQUEUES_PER_10K = 40;

  // Cadence tolerance. Expected bot updates = elapsedTicks / tickRatio
  // (bot.ts:66-68). Anything under half of that means the bot is being skipped.
  const MIN_CADENCE_FRACTION = 0.5;
  // Mission logic runs on every 3rd bot update (bot.ts:205-206).
  const MISSION_UPDATE_DIVISOR = 3;

  // Device budget from the porting rules: 7 bots in an 8-player FFA at <1ms/tick.
  const MAX_BOT_MS_PER_TICK = 1.0;
  const MAX_TOTAL_MS_PER_TICK = 8.0;

  // A bot with a conyard should not sit in low power more than half the match.
  const MAX_LOW_POWER_FRACTION = 0.5;

  const DEFAULTS = {
    ticks: 25000,
    evalTick: EVAL_TICK,
    sample: 150,
    maxWallSeconds: 900,
    detectNondeterminism: true,
    stackBudget: 20000,
    verbose: true,
  };

  // Stacks that mean sim code. GUI/sound/renderer code is allowed to use
  // Math.random and Date.now; the simulation is not.
  const SIM_STACK_RE =
    /thirdpartbot|builtIn\/bot|game\/ai\/|missionController|attackMission|defenceMission|baseBuildingMission|expansionMission|garrisonMission|scoutingMission|spyMission|engineerMission|retreatMission|combatSquad|queueController|awareness|sectorThreat|threatCalculator|superweapons|aiTriggerDb|doctrines/i;
  const SIM_ERROR_RE =
    /BotManager|BuiltInBot|Bot "|Mission|Squad|queue|TypeError|is not a function|Cannot read|undefined/i;

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  const dbg = () => window.__ra2debug;
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fmt = (a) => {
    try {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      return typeof a === 'string' ? a : JSON.stringify(a);
    } catch (_e) {
      return String(a);
    }
  };

  function requireGame() {
    const d = dbg();
    if (!d || !d.game || !d.gameScreen || !d.gameScreen.gameTurnMgr) {
      throw new Error('[liveness] no running game — start a skirmish first');
    }
    return d;
  }

  function makeProbe(bot, inner, player) {
    return {
      name: String(bot.name || '').replace(/@/g, ''),
      bot, inner, player,
      lobbyDifficulty: DIFFICULTY_BY_ENUM[player.aiDifficulty] ?? String(player.aiDifficulty),
      difficulty: undefined,
      personality: undefined,
      doctrine: undefined,
      opening: undefined,
      tickRatio: undefined,
      // instrumentation counters
      tickCalls: 0,
      aiMillis: 0,
      controllerPasses: 0,
      queuePasses: 0,
      // log tallies (complete, not the 20-entry ring)
      log: {
        missionsAdded: 0, attackMissionsAdded: 0, disbands: 0, dequeues: 0,
        pauses: 0, resumes: 0, cancelsTotal: 0, cancelsByName: Object.create(null),
        logLaunches: 0, placementFails: 0, warnings: 0, quit: 0, fireSale: 0,
        recent: [],
      },
      // sampled series
      samples: 0,
      lowPowerSamples: 0,
      peakArmy: 0,
      peakReach: 0,
      peakBuildings: 0,
      harvesterSamplesAfter3k: 0,
      harvesterZeroSamplesAfter3k: 0,
      launchTicks: [],
      lastSeenLaunchAt: -Infinity,
      waveBase: null,
      cfgSnapshot: null,
      final: null,
    };
  }

  const state = {
    attached: false,
    running: false,
    restore: [],
    probes: [],
    byBot: new Map(),
    byController: new Map(),
    byQueue: new Map(),
    errors: [],
    nondet: [],
    stackBudget: 0,
  };

  function tallyMessage(probe, raw) {
    const msg = String(raw);
    const L = probe.log;
    if (L.recent.length < 400) L.recent.push(msg);
    let m;
    if ((m = /^Added mission: (\S+)/.exec(msg))) {
      L.missionsAdded++;
      if (m[1].startsWith('attack_')) L.attackMissionsAdded++;
      return;
    }
    if (/disbanding as requested/.test(msg)) { L.disbands++; return; }
    if ((m = /^Cancelling ready (\S+)/.exec(msg))) {
      L.cancelsTotal++;
      L.cancelsByName[m[1]] = (L.cancelsByName[m[1]] || 0) + 1;
      return;
    }
    if (/^Dequeueing queue/.test(msg)) { L.dequeues++; return; }
    if (/^Pausing queue/.test(msg)) { L.pauses++; return; }
    if (/^Resuming (unit )?queue/.test(msg)) { L.resumes++; return; }
    if (/launching after timeout|launching with partial squad/.test(msg)) { L.logLaunches++; return; }
    if (/but nowhere to place it/.test(msg)) { L.placementFails++; return; }
    if (/^WARNING:/.test(msg)) { L.warnings++; return; }
    if (/No army or production left, quitting/.test(msg)) { L.quit++; return; }
    if (/FIRE SALE/.test(msg)) { L.fireSale++; return; }
  }

  function attach() {
    if (state.attached) return state.probes;
    const d = requireGame();
    const game = d.game;
    const botMap = game.botManager && game.botManager.bots;
    if (!botMap || typeof botMap.forEach !== 'function') {
      throw new Error('[liveness] game.botManager.bots is not a Map — engine layout changed');
    }

    state.probes = [];
    state.byBot = new Map();
    state.byController = new Map();
    state.byQueue = new Map();
    state.errors = [];
    state.nondet = [];
    state.restore = [];

    const skipped = [];
    botMap.forEach((bot) => {
      const inner = bot && bot.innerBot;
      const player = game.getPlayerByName(bot && bot.name);
      if (!inner || !player) {
        skipped.push(`${bot && bot.name} (${bot && bot.constructor && bot.constructor.name})`);
        return;
      }
      const probe = makeProbe(bot, inner, player);
      state.probes.push(probe);
      state.byBot.set(inner, probe);
      if (inner.missionController) state.byController.set(inner.missionController, probe);
      if (inner.queueController) state.byQueue.set(inner.queueController, probe);

      // Complete log capture: shadow the instance method. The mission/queue
      // loggers are arrow closures over `this.logBotStatus`, so the shadow is
      // picked up dynamically even though they were created in onGameStart.
      const botProto = Object.getPrototypeOf(inner);
      const origLog = botProto.logBotStatus;
      if (typeof origLog === 'function') {
        inner.logBotStatus = function (message, sayInGame) {
          try { tallyMessage(probe, message); } catch (_e) { /* never break the sim */ }
          return origLog.call(this, message, sayInGame);
        };
        state.restore.push(() => { delete inner.logBotStatus; });
      }
    });

    if (!state.probes.length) {
      throw new Error(`[liveness] no BuiltInBot players found (skipped: ${skipped.join(', ') || 'none'})`);
    }

    const sample = state.probes[0].inner;

    // Cadence + cost: BuiltInBot.onGameTick.
    wrapPrototype(Object.getPrototypeOf(sample), 'onGameTick', function (orig, args) {
      const probe = state.byBot.get(this);
      if (!probe) return orig.apply(this, args);
      const t0 = performance.now();
      try {
        return orig.apply(this, args);
      } finally {
        probe.aiMillis += performance.now() - t0;
        probe.tickCalls++;
      }
    });

    // The gate that died: MissionController.onAiUpdate.
    if (sample.missionController) {
      wrapPrototype(Object.getPrototypeOf(sample.missionController), 'onAiUpdate', function (orig, args) {
        const probe = state.byController.get(this);
        if (probe) probe.controllerPasses++;
        return orig.apply(this, args);
      });
    }
    // QueueController.onAiUpdate runs on every bot update (bot.ts:217).
    if (sample.queueController) {
      wrapPrototype(Object.getPrototypeOf(sample.queueController), 'onAiUpdate', function (orig, args) {
        const probe = state.byQueue.get(this);
        if (probe) probe.queuePasses++;
        return orig.apply(this, args);
      });
    }

    state.attached = true;
    if (skipped.length) {
      console.warn(`[liveness] skipped non-BuiltIn bots: ${skipped.join(', ')}`);
    }
    return state.probes;
  }

  function wrapPrototype(proto, method, impl) {
    if (!proto || typeof proto[method] !== 'function') return;
    const flag = `__ra2Liveness_${method}`;
    if (proto[flag]) return;
    const orig = proto[method];
    proto[method] = function (...args) { return impl.call(this, orig, args); };
    proto[flag] = true;
    state.restore.push(() => { proto[method] = orig; delete proto[flag]; });
  }

  function detach() {
    while (state.restore.length) {
      const fn = state.restore.pop();
      try { fn(); } catch (e) { console.warn('[liveness] restore failed', e); }
    }
    state.attached = false;
  }

  // ---------------------------------------------------------------------------
  // Sampling
  // ---------------------------------------------------------------------------

  function startLocationOf(game, probe) {
    try {
      const api = game.botManager && game.botManager.gameApi;
      if (api) {
        const loc = api.getPlayerData(probe.player.name).startLocation;
        if (loc && typeof loc.x === 'number') return loc;
      }
    } catch (_e) { /* fall through */ }
    // player.startLocation is a START POSITION INDEX, never a Vector2
    // (game/GameFactory.ts:167 -> game/player/PlayerFactory.ts:19,
    //  game/api/GameApi.ts:88). Resolve it against the map.
    const locs = (game.map && game.map.startingLocations) || [];
    return locs[num(probe.player.startLocation, 0)] || null;
  }

  function sampleBot(game, probe) {
    const player = probe.player;
    const objects = player.getOwnedObjects();
    const hist = Object.create(null);
    let buildings = 0, army = 0, harvesters = 0, defenses = 0, powerPlants = 0;
    const start = startLocationOf(game, probe);
    let reach = 0;

    for (const o of objects) {
      const r = o.rules || {};
      if (r.harvester) harvesters++;
      if (o.isBuilding && o.isBuilding()) {
        buildings++;
        // Classify from rules, not from name patterns: base defenses have their
        // own per-difficulty budget (baseBuildingMission.ts:37) and power
        // producers their own cap (powerPlant.ts:8).
        const entry = hist[o.name] || (hist[o.name] = {
          count: 0, isDefense: !!r.isBaseDefense, isPower: num(r.power) > 0,
        });
        entry.count++;
        if (r.isBaseDefense) defenses++;
        if (num(r.power) > 0) powerPlants++;
      } else {
        if (r.isSelectableCombatant) army++;
        if (start && o.tile) {
          const dx = o.tile.rx - start.x;
          const dy = o.tile.ry - start.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > reach) reach = dist;
        }
      }
    }

    const cfg = probe.inner.strategy && probe.inner.strategy.config;
    if (cfg) {
      probe.difficulty = cfg.difficultyId;
      probe.personality = cfg.personalityId;
      probe.doctrine = cfg.matchDoctrine && cfg.matchDoctrine.doctrine && cfg.matchDoctrine.doctrine.id;
      probe.opening = cfg.matchDoctrine && cfg.matchDoctrine.opening && cfg.matchDoctrine.opening.id;
      probe.cfgSnapshot = cfg;
    }
    probe.tickRatio = probe.inner.tickRatio;

    // AttackMissionFactory bookkeeping is authoritative: waveIndex increments
    // in the onLaunch callback (attackMission.ts:710-712) and lastLaunchAt
    // records the launch tick, so no sampling can miss a wave.
    const factory = probe.inner.strategy && probe.inner.strategy.attackFactory;
    if (factory) {
      if (probe.waveBase === null) {
        probe.waveBase = probe.difficulty === 'brutal' ? 1 : 0;
        probe.cooldownTicks = num(factory.visibleTargetCooldownTicks, 1500);
        probe.launchTimeoutTicks = num(factory.launchTimeoutTicks, 2400);
        probe.firstAttackAllowedTick = num(factory.firstAttackAllowedTick, 0);
        probe.maxPreparing = num(factory.maxPreparing, 2);
      }
      const last = num(factory.lastLaunchAt, -1);
      if (last >= 0 && last > probe.lastSeenLaunchAt) {
        probe.lastSeenLaunchAt = last;
        probe.launchTicks.push(last);
      }
      probe.waveIndex = num(factory.waveIndex, 0);
    }

    const missions = (probe.inner.missionController && probe.inner.missionController.getMissions()) || [];
    let attacking = 0, preparing = 0;
    for (const m of missions) {
      const n = m.getUniqueName ? m.getUniqueName() : '';
      if (n.startsWith('attack_') && m.getState) {
        if (m.getState() === 0) preparing++;
        else attacking++;
      }
    }

    const pw = player.powerTrait;
    const power = num(pw && pw.power);
    const drain = num(pw && pw.drain);
    if (buildings > 0 && power < drain) probe.lowPowerSamples++;

    const tick = game.currentTick;
    if (tick >= 3000 && !player.defeated) {
      probe.harvesterSamplesAfter3k++;
      if (harvesters === 0) probe.harvesterZeroSamplesAfter3k++;
    }

    probe.samples++;
    if (army > probe.peakArmy) probe.peakArmy = army;
    if (reach > probe.peakReach) probe.peakReach = reach;
    if (buildings > probe.peakBuildings) probe.peakBuildings = buildings;

    probe.final = {
      tick, buildings, army, harvesters, defenses, powerPlants, hist,
      credits: num(player.credits), power, drain,
      defeated: !!player.defeated,
      missions: missions.length, attacking, preparing,
      reach: Math.round(reach),
    };
  }

  function sampleAll(game) {
    for (const probe of state.probes) {
      try { sampleBot(game, probe); } catch (e) { console.warn(`[liveness] sample failed for ${probe.name}`, e); }
    }
  }

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  function evaluate(probe, endTick, opts) {
    const fail = [];
    const warn = [];
    const f = probe.final || {};
    const bar = EXPECT[probe.difficulty] || EXPECT.normal;
    const mature = endTick >= opts.evalTick;
    const per10k = endTick / 10000;

    // --- 1. Wiring: lobby difficulty must equal the profile actually running.
    if (probe.lobbyDifficulty && probe.difficulty && probe.lobbyDifficulty !== probe.difficulty) {
      fail.push(`lobby said "${probe.lobbyDifficulty}" but the bot runs the "${probe.difficulty}" profile`);
    }
    if (!probe.difficulty) {
      fail.push('strategy.config is missing — onGameStart never rolled a config');
    }

    // --- 2. Is the bot thinking at all?
    const ratio = num(probe.tickRatio, 0);
    if (ratio > 0) {
      const expectedTicks = endTick / ratio;
      if (probe.tickCalls < expectedTicks * MIN_CADENCE_FRACTION) {
        fail.push(`bot update cadence dead: ${probe.tickCalls} onGameTick bodies vs ~${Math.round(expectedTicks)} expected (tickRatio ${ratio})`);
      }
      const expectedPasses = probe.tickCalls / MISSION_UPDATE_DIVISOR;
      if (probe.controllerPasses === 0) {
        fail.push('MissionController.onAiUpdate NEVER ran — the mission gate is dead (no missions, no attacks, no superweapons)');
      } else if (probe.controllerPasses < expectedPasses * MIN_CADENCE_FRACTION) {
        fail.push(`mission cadence low: ${probe.controllerPasses} passes vs ~${Math.round(expectedPasses)} expected (every 3rd bot update)`);
      }
      if (probe.queuePasses < probe.tickCalls * MIN_CADENCE_FRACTION) {
        fail.push(`QueueController cadence low: ${probe.queuePasses} passes vs ${probe.tickCalls} bot updates`);
      }
    } else {
      fail.push('tickRatio is unset — onGameStart did not complete');
    }

    if (endTick > 900 && !(probe.inner.strategy && probe.inner.strategy.attackFactory)) {
      fail.push('DefaultStrategy.attackFactory is still null — the strategy update never ran');
    }
    if (probe.log.missionsAdded === 0) {
      fail.push('no mission was ever added');
    }

    if (f.defeated) {
      // Being killed by another bot is a legitimate outcome; stop here.
      return { fail, warn, dead: true };
    }

    // --- 3. Base growth and structure spam.
    if (mature) {
      if (f.buildings < bar.minBuildings) fail.push(`only ${f.buildings} buildings at tick ${endTick}`);
      const distinct = Object.keys(f.hist || {}).length;
      if (distinct < bar.minDistinct) fail.push(`only ${distinct} distinct structures (build order is stuck)`);
    }
    for (const name of Object.keys(f.hist || {})) {
      const entry = f.hist[name];
      // Base defenses are governed by the per-difficulty budget checked below,
      // not by SAME_STRUCTURE_HARD_CAP (baseBuildingMission.ts:170).
      if (entry.isDefense) continue;
      const cap = entry.isPower ? POWER_PLANT_CAP : SAME_STRUCTURE_HARD_CAP;
      if (entry.count > cap + CAP_SLACK) {
        fail.push(`structure spam: ${entry.count}x ${name} (cap ${cap})`);
      }
    }
    if (f.defenses > bar.defenseCap + CAP_SLACK) {
      fail.push(`${f.defenses} base defenses exceeds the ${probe.difficulty} cap of ${bar.defenseCap}`);
    }

    // --- 4. Queue churn (the cancel loop).
    const cancelBudget = Math.max(3, Math.round(CANCELS_TOTAL_PER_10K * per10k));
    const perNameBudget = Math.max(2, Math.round(CANCELS_PER_NAME_PER_10K * per10k));
    if (probe.log.cancelsTotal > cancelBudget) {
      fail.push(`${probe.log.cancelsTotal} queue cancels (budget ${cancelBudget})`);
    }
    for (const name of Object.keys(probe.log.cancelsByName)) {
      const n = probe.log.cancelsByName[name];
      if (n > perNameBudget) {
        fail.push(`cancel loop on ${name}: ${n} cancels (budget ${perNameBudget}) — something re-requests it behind the queue controller`);
      }
    }
    const dequeueBudget = Math.max(5, Math.round(DEQUEUES_PER_10K * per10k));
    if (probe.log.dequeues > dequeueBudget) {
      warn.push(`${probe.log.dequeues} queue dequeues (budget ${dequeueBudget}) — priority thrash`);
    }

    // --- 5. Offense: waves must actually LAUNCH, at the cadence the code promises.
    const launches = num(probe.waveIndex, 0) - num(probe.waveBase, 0);
    if (mature && launches < bar.minLaunches) {
      fail.push(`only ${launches} attack wave(s) launched by tick ${endTick} (expected >= ${bar.minLaunches})`);
    }
    const firstLaunch = probe.launchTicks.length ? probe.launchTicks[0] : null;
    if (endTick >= bar.firstLaunchBy && firstLaunch === null) {
      fail.push(`no attack wave had launched by tick ${bar.firstLaunchBy}`);
    }
    if (probe.launchTicks.length >= 2) {
      const bound = (num(probe.cooldownTicks, 1500) + num(probe.launchTimeoutTicks, 2400)) * 2.5;
      let worst = 0, worstAt = 0;
      for (let i = 1; i < probe.launchTicks.length; i++) {
        const gap = probe.launchTicks[i] - probe.launchTicks[i - 1];
        if (gap > worst) { worst = gap; worstAt = probe.launchTicks[i]; }
      }
      const tail = endTick - probe.launchTicks[probe.launchTicks.length - 1];
      if (worst > bound) {
        fail.push(`${Math.round(worst)}-tick gap between waves at tick ${worstAt} (bound ${Math.round(bound)} = 2.5x cooldown+timeout)`);
      }
      if (tail > bound) {
        fail.push(`no wave in the last ${Math.round(tail)} ticks (bound ${Math.round(bound)}) — the bot stopped attacking`);
      }
    }
    if (mature && launches >= 2 && probe.peakReach < 12) {
      fail.push(`army never left home (peak reach ${Math.round(probe.peakReach)} tiles) despite ${launches} launches`);
    }

    // --- 6. Economy and army.
    if (mature && probe.peakArmy < bar.minPeakArmy) {
      fail.push(`peak army only ${probe.peakArmy} combat units (expected >= ${bar.minPeakArmy})`);
    }
    if (probe.harvesterSamplesAfter3k > 0) {
      const zeroFrac = probe.harvesterZeroSamplesAfter3k / probe.harvesterSamplesAfter3k;
      if (zeroFrac > 0.5) {
        fail.push(`no harvester for ${Math.round(zeroFrac * 100)}% of the match after tick 3000 — economy is dead`);
      }
    }
    if (probe.samples > 0) {
      const lowFrac = probe.lowPowerSamples / probe.samples;
      if (lowFrac > MAX_LOW_POWER_FRACTION) {
        fail.push(`low power in ${Math.round(lowFrac * 100)}% of samples`);
      }
    }

    // --- 7. Cost.
    const msPerTick = endTick > 0 ? probe.aiMillis / endTick : 0;
    if (msPerTick > MAX_BOT_MS_PER_TICK) {
      fail.push(`AI cost ${msPerTick.toFixed(3)} ms/tick exceeds the ${MAX_BOT_MS_PER_TICK} ms device budget`);
    }
    if (probe.log.warnings > 0) {
      warn.push(`${probe.log.warnings} bot WARNING log line(s) (unit in multiple missions)`);
    }

    return { fail, warn, dead: false, launches, msPerTick };
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  function installErrorCapture() {
    const origError = console.error;
    console.error = function (...args) {
      try { state.errors.push(args.map(fmt).join(' ')); } catch (_e) { /* ignore */ }
      return origError.apply(console, args);
    };
    state.restore.push(() => { console.error = origError; });

    const onError = (e) => state.errors.push(`window.onerror: ${e.message || e}`);
    const onRejection = (e) => state.errors.push(`unhandledrejection: ${fmt(e.reason)}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    state.restore.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  }

  function installNondeterminismTripwire(budget) {
    state.stackBudget = budget;
    const record = (api) => {
      if (state.stackBudget <= 0) return;
      state.stackBudget--;
      const stack = new Error().stack || '';
      if (SIM_STACK_RE.test(stack)) {
        if (state.nondet.length < 10) state.nondet.push({ api, stack });
      }
    };
    const origRandom = Math.random;
    Math.random = function () { record('Math.random'); return origRandom(); };
    state.restore.push(() => { Math.random = origRandom; });

    const origNow = Date.now;
    Date.now = function () { record('Date.now'); return origNow(); };
    state.restore.push(() => { Date.now = origNow; });
  }

  async function run(options) {
    if (state.running) throw new Error('[liveness] already running');
    const opts = Object.assign({}, DEFAULTS, options || {});
    const d = requireGame();
    const game = d.game;
    const tm = d.gameScreen.gameTurnMgr;

    if (game.currentTick > 600) {
      console.warn(`[liveness] attaching at tick ${game.currentTick}; cadence and wave counts are measured from tick 0, so results may be pessimistic. Restart the skirmish for a clean run.`);
    }

    state.running = true;
    attach();
    installErrorCapture();
    if (opts.detectNondeterminism) installNondeterminismTripwire(opts.stackBudget);

    // Take ownership of the clock: neutralise the rAF driver so the harness
    // is the only thing stepping turns and ms/tick is meaningful.
    const step = tm.doGameTurn.bind(tm);
    tm.doGameTurn = function () { return true; };
    state.restore.push(() => { delete tm.doGameTurn; });

    const startTick = game.currentTick;
    const targetTick = startTick + opts.ticks;
    let stamp = performance.now();
    const wallStart = performance.now();
    let simMillis = 0;
    let stopReason = 'target reached';

    try {
      sampleAll(game);
      while (game.currentTick < targetTick) {
        const burstEnd = Math.min(targetTick, game.currentTick + opts.sample);
        const t0 = performance.now();
        while (game.currentTick < burstEnd) {
          stamp += tm.getTurnMillis();
          step(stamp);
          if (game.status === 2) break;
        }
        simMillis += performance.now() - t0;
        sampleAll(game);
        if (game.status === 2) { stopReason = 'game ended'; break; }
        const alive = state.probes.filter((p) => !p.player.defeated).length;
        if (alive <= 1) { stopReason = `only ${alive} bot(s) alive`; break; }
        if ((performance.now() - wallStart) / 1000 > opts.maxWallSeconds) {
          stopReason = 'wall-clock timeout';
          break;
        }
        if (opts.verbose && game.currentTick % 3000 < opts.sample) {
          console.log(`[liveness] tick ${game.currentTick}/${targetTick} (${(simMillis / Math.max(1, game.currentTick - startTick)).toFixed(2)} ms/tick)`);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      detach();
      state.running = false;
    }

    return report(game, startTick, simMillis, stopReason, opts);
  }

  function report(game, startTick, simMillis, stopReason, opts) {
    const endTick = game.currentTick;
    const elapsed = Math.max(1, endTick - startTick);
    const rows = [];
    let failed = 0;

    for (const probe of state.probes) {
      const verdict = evaluate(probe, endTick, opts);
      const f = probe.final || {};
      const worst = Object.entries(f.hist || {})
        .filter(([, e]) => !e.isDefense)
        .sort((a, b) => b[1].count - a[1].count)[0] || ['-', { count: 0 }];
      const isFail = verdict.fail.length > 0;
      if (isFail) failed++;
      rows.push({
        bot: probe.name,
        lobby: probe.lobbyDifficulty,
        profile: probe.difficulty,
        personality: probe.personality,
        doctrine: probe.doctrine,
        botTicks: probe.tickCalls,
        missionPasses: probe.controllerPasses,
        queuePasses: probe.queuePasses,
        missions: f.missions,
        waves: num(verdict.launches, 0),
        lastWave: probe.launchTicks.length ? probe.launchTicks[probe.launchTicks.length - 1] : '-',
        bld: f.buildings,
        distinct: Object.keys(f.hist || {}).length,
        worst: `${worst[0]}x${worst[1].count}`,
        army: f.army,
        peakArmy: probe.peakArmy,
        reach: Math.round(probe.peakReach),
        power: `${f.power}/${f.drain}`,
        cancels: probe.log.cancelsTotal,
        msTick: +num(verdict.msPerTick).toFixed(3),
        dead: f.defeated ? 'yes' : '',
        verdict: isFail ? 'FAIL' : (verdict.warn.length ? 'pass*' : 'pass'),
        why: verdict.fail.concat(verdict.warn.map((w) => `(warn) ${w}`)).join('; '),
      });
    }

    console.table(rows);

    const simErrors = state.errors.filter((e) => SIM_ERROR_RE.test(e));
    const identities = new Set(state.probes.map((p) => `${p.personality}:${p.doctrine}`));
    const totalMsPerTick = simMillis / elapsed;
    const aiMsPerTick = state.probes.reduce((s, p) => s + p.aiMillis, 0) / elapsed;

    console.log(
      `[liveness v${HARNESS_VERSION}] ticks ${startTick}->${endTick} (${elapsed}), stopped: ${stopReason}\n` +
      `  sim ${totalMsPerTick.toFixed(3)} ms/tick, all AI ${aiMsPerTick.toFixed(3)} ms/tick\n` +
      `  ${identities.size}/${state.probes.length} distinct personality:doctrine pairs\n` +
      `  ${state.errors.length} console errors (${simErrors.length} sim-related), ${state.nondet.length} nondeterminism hits`
    );
    if (simErrors.length) console.log('[liveness] sim errors:', simErrors.slice(0, 10));
    if (state.nondet.length) {
      console.log('[liveness] NONDETERMINISM — sim code called a forbidden clock/RNG:');
      state.nondet.forEach((n) => console.log(`  ${n.api}\n${n.stack}`));
    }

    const globalFail = [];
    if (simErrors.length) globalFail.push(`${simErrors.length} sim-related console errors`);
    if (state.nondet.length) globalFail.push(`${state.nondet.length} Math.random/Date.now calls from sim code (lockstep break)`);
    if (totalMsPerTick > MAX_TOTAL_MS_PER_TICK) globalFail.push(`sim ${totalMsPerTick.toFixed(2)} ms/tick over the ${MAX_TOTAL_MS_PER_TICK} ms budget`);
    if (identities.size < Math.min(3, state.probes.length)) {
      globalFail.push(`only ${identities.size} distinct personality:doctrine pair(s) across ${state.probes.length} bots`);
    }
    if (endTick < opts.evalTick) {
      globalFail.push(`run ended at tick ${endTick}, before the ${opts.evalTick}-tick evaluation point — maturity invariants were skipped`);
    }
    if (globalFail.length) console.log('[liveness] global failures:', globalFail);

    const pass = failed === 0 && globalFail.length === 0;
    console.log(pass
      ? `[liveness] PASS — all ${state.probes.length} bots alive and acting`
      : `[liveness] FAIL — ${failed}/${state.probes.length} bot(s) failed, ${globalFail.length} global failure(s)`);

    return {
      pass, failed, rows, globalFail, stopReason,
      startTick, endTick, elapsed,
      msPerTick: +totalMsPerTick.toFixed(3),
      aiMsPerTick: +aiMsPerTick.toFixed(3),
      errors: state.errors, simErrors, nondeterminism: state.nondet,
    };
  }

  function snapshot() {
    const d = requireGame();
    const wasAttached = state.attached;
    if (!wasAttached) attach();
    sampleAll(d.game);
    const rows = state.probes.map((p) => ({
      bot: p.name, lobby: p.lobbyDifficulty, profile: p.difficulty,
      personality: p.personality, doctrine: p.doctrine, opening: p.opening,
      tickRatio: p.tickRatio,
      missions: p.final && p.final.missions,
      waves: num(p.waveIndex, 0) - num(p.waveBase, 0),
      bld: p.final && p.final.buildings, army: p.final && p.final.army,
      credits: p.final && p.final.credits,
      power: p.final && `${p.final.power}/${p.final.drain}`,
      dead: p.final && p.final.defeated ? 'yes' : '',
    }));
    console.table(rows);
    if (!wasAttached) detach();
    return rows;
  }

  function help() {
    console.log(`RA2 AI liveness harness v${HARNESS_VERSION}
  await RA2Liveness.run()                       25000 ticks, full assertions
  await RA2Liveness.run({ ticks: 12000 })       shorter smoke run
  await RA2Liveness.run({ detectNondeterminism: false })
  RA2Liveness.snapshot()                        read the current state, no sim
  RA2Liveness.detach()                          emergency: undo all patches

Set up a MIXED-difficulty skirmish (>=1 Easy, >=1 Normal, >=1 Brutal, 5-7 bots)
on an 8-player map and start it fresh; the invariants are absolute-tick based.`);
  }

  window.RA2Liveness = { run, snapshot, attach, detach, help, EXPECT, version: HARNESS_VERSION };
  console.log(`[liveness v${HARNESS_VERSION}] ready — await RA2Liveness.run(), or RA2Liveness.help()`);
})();
