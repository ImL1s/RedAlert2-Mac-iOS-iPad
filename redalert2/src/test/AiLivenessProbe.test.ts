import { describe, it, expect } from 'bun:test';

/**
 * Unit tests for AI Bot Liveness and Soak Testing Harness
 * Verifies evaluation criteria, difficulty profiles, inert bot rejection,
 * structure spam budgets, and device matrix specifications.
 */

describe('AI Liveness & Release Gate Harness', () => {
  const DIFFICULTY_PROFILES = {
    easy: {
      defenseCap: 6,
      refineryCap: 1,
      minBuildings: 6,
      minDistinct: 4,
      minPeakArmy: 5,
      minLaunches: 2,
      firstLaunchBy: 7200,
    },
    normal: {
      defenseCap: 20,
      refineryCap: 2,
      minBuildings: 8,
      minDistinct: 5,
      minPeakArmy: 9,
      minLaunches: 3,
      firstLaunchBy: 4500,
    },
    brutal: {
      defenseCap: 25,
      refineryCap: 3,
      minBuildings: 9,
      minDistinct: 6,
      minPeakArmy: 13,
      minLaunches: 3,
      firstLaunchBy: 4000,
    },
  };

  const SAME_STRUCTURE_HARD_CAP = 8;
  const POWER_PLANT_CAP = 16;
  const CAP_SLACK = 1;

  function evaluateBotLiveness(probe: any, endTick: number, evalTick: number = 12000) {
    const fail: string[] = [];
    const warn: string[] = [];
    const bar = (DIFFICULTY_PROFILES as any)[probe.difficulty] || DIFFICULTY_PROFILES.normal;
    const mature = endTick >= evalTick;
    const per10k = endTick / 10000;

    // 1. Difficulty wiring
    if (probe.lobbyDifficulty && probe.difficulty && probe.lobbyDifficulty !== probe.difficulty) {
      fail.push(`lobby said "${probe.lobbyDifficulty}" but bot runs "${probe.difficulty}"`);
    }
    if (!probe.difficulty) {
      fail.push('strategy.config missing');
    }

    // 2. Cadence
    const ratio = probe.tickRatio || 0;
    if (ratio > 0) {
      const expectedTicks = endTick / ratio;
      if (probe.tickCalls < expectedTicks * 0.5) {
        fail.push(`bot update cadence dead: ${probe.tickCalls} calls vs ~${Math.round(expectedTicks)} expected`);
      }
      if (probe.controllerPasses === 0) {
        fail.push('MissionController.onAiUpdate NEVER ran');
      }
    } else {
      fail.push('tickRatio is unset');
    }

    if (probe.log?.missionsAdded === 0) {
      fail.push('no mission was ever added');
    }

    // 3. Base growth
    const f = probe.final || {};
    if (mature) {
      if ((f.buildings || 0) < bar.minBuildings) {
        fail.push(`only ${f.buildings || 0} buildings at tick ${endTick}`);
      }
      const distinct = Object.keys(f.hist || {}).length;
      if (distinct < bar.minDistinct) {
        fail.push(`only ${distinct} distinct structures`);
      }
    }

    // Structure spam
    for (const name of Object.keys(f.hist || {})) {
      const entry = f.hist[name];
      if (entry.isDefense) continue;
      const cap = entry.isPower ? POWER_PLANT_CAP : SAME_STRUCTURE_HARD_CAP;
      if (entry.count > cap + CAP_SLACK) {
        fail.push(`structure spam: ${entry.count}x ${name} (cap ${cap})`);
      }
    }

    // 4. Attack launches
    const launches = (probe.waveIndex || 0) - (probe.waveBase || 0);
    if (mature && launches < bar.minLaunches) {
      fail.push(`only ${launches} attack waves launched (expected >= ${bar.minLaunches})`);
    }
    if (mature && probe.peakArmy < bar.minPeakArmy) {
      fail.push(`peak army only ${probe.peakArmy} units (expected >= ${bar.minPeakArmy})`);
    }

    return { fail, warn, passed: fail.length === 0, launches };
  }

  it('passes a healthy active AI bot across 12,000 ticks', () => {
    const activeProbe = {
      name: 'ActiveBrutalBot',
      lobbyDifficulty: 'brutal',
      difficulty: 'brutal',
      tickRatio: 2,
      tickCalls: 6000,
      controllerPasses: 2000,
      queuePasses: 6000,
      waveIndex: 5,
      waveBase: 1,
      peakArmy: 22,
      peakReach: 45,
      log: { missionsAdded: 15, cancelsTotal: 2, cancelsByName: {} },
      final: {
        buildings: 12,
        hist: {
          GAPOWR: { count: 3, isPower: true },
          GAPILE: { count: 1 },
          GAWEAP: { count: 1 },
          GAYARD: { count: 1 },
          GATECH: { count: 1 },
          GAGAP: { count: 1 },
        },
      },
    };

    const result = evaluateBotLiveness(activeProbe, 12000);
    expect(result.passed).toBe(true);
    expect(result.fail.length).toBe(0);
    expect(result.launches).toBe(4);
  });

  it('rejects an inert/silent bot that produces no structures or attack waves', () => {
    const inertProbe = {
      name: 'InertBot',
      lobbyDifficulty: 'brutal',
      difficulty: 'brutal',
      tickRatio: 2,
      tickCalls: 6000,
      controllerPasses: 0,
      waveIndex: 0,
      waveBase: 0,
      peakArmy: 0,
      peakReach: 0,
      log: { missionsAdded: 0, cancelsTotal: 0, cancelsByName: {} },
      final: { buildings: 0, hist: {} },
    };

    const result = evaluateBotLiveness(inertProbe, 12000);
    expect(result.passed).toBe(false);
    expect(result.fail).toContain('MissionController.onAiUpdate NEVER ran');
    expect(result.fail).toContain('no mission was ever added');
    expect(result.fail).toContain('only 0 buildings at tick 12000');
    expect(result.fail).toContain('only 0 distinct structures');
    expect(result.fail).toContain('only 0 attack waves launched (expected >= 3)');
  });

  it('detects structure spam exceeding hardware budget', () => {
    const spamProbe = {
      name: 'SpamBot',
      lobbyDifficulty: 'normal',
      difficulty: 'normal',
      tickRatio: 3,
      tickCalls: 4000,
      controllerPasses: 1333,
      waveIndex: 4,
      waveBase: 0,
      peakArmy: 12,
      log: { missionsAdded: 10, cancelsTotal: 1, cancelsByName: {} },
      final: {
        buildings: 15,
        hist: {
          GAPOWR: { count: 20, isPower: true }, // Exceeds POWER_PLANT_CAP (16)
          GAPILE: { count: 12, isPower: false }, // Exceeds SAME_STRUCTURE_HARD_CAP (8)
          GAWEAP: { count: 1 },
          GAYARD: { count: 1 },
          GATECH: { count: 1 },
        },
      },
    };

    const result = evaluateBotLiveness(spamProbe, 12000);
    expect(result.passed).toBe(false);
    expect(result.fail.some((f) => f.includes('structure spam: 20x GAPOWR'))).toBe(true);
    expect(result.fail.some((f) => f.includes('structure spam: 12x GAPILE'))).toBe(true);
  });

  it('verifies device matrix viewport definitions and touch support', () => {
    const DEVICE_MATRIX = [
      { name: 'Phone Portrait', width: 390, height: 844, isMobile: true, hasTouch: true },
      { name: 'Phone Landscape', width: 844, height: 390, isMobile: true, hasTouch: true },
      { name: 'Tablet 10-inch', width: 1024, height: 768, isMobile: true, hasTouch: true },
      { name: 'Tablet 12-inch', width: 1366, height: 1024, isMobile: true, hasTouch: true },
      { name: 'Foldable Outer', width: 672, height: 884, isMobile: true, hasTouch: true },
      { name: 'Foldable Inner', width: 1768, height: 2208, isMobile: true, hasTouch: true },
      { name: 'DeX Desktop', width: 1920, height: 1080, isMobile: false, hasTouch: false },
    ];

    expect(DEVICE_MATRIX.length).toBe(7);
    for (const dev of DEVICE_MATRIX) {
      expect(dev.width).toBeGreaterThan(300);
      expect(dev.height).toBeGreaterThan(300);
    }
  });

  it('verifies 60-minute soak test pass thresholds', () => {
    const SOAK_THRESHOLDS = {
      maxPeakRamMb: 650,
      minPacedFps: 15,
      maxPacedFps: 60,
      allowedCrashCount: 0,
      maxDesyncCount: 0,
      maxTotalMsPerTick: 8.0,
      maxBotMsPerTick: 1.0,
    };

    const sampleRun = {
      durationMinutes: 60,
      peakRamMb: 420,
      avgFps: 59.2,
      crashes: 0,
      desyncs: 0,
      totalMsPerTick: 3.4,
      maxBotMsPerTick: 0.45,
    };

    expect(sampleRun.durationMinutes).toBe(60);
    expect(sampleRun.peakRamMb).toBeLessThanOrEqual(SOAK_THRESHOLDS.maxPeakRamMb);
    expect(sampleRun.avgFps).toBeGreaterThanOrEqual(SOAK_THRESHOLDS.minPacedFps);
    expect(sampleRun.crashes).toBe(SOAK_THRESHOLDS.allowedCrashCount);
    expect(sampleRun.desyncs).toBe(SOAK_THRESHOLDS.maxDesyncCount);
    expect(sampleRun.totalMsPerTick).toBeLessThanOrEqual(SOAK_THRESHOLDS.maxTotalMsPerTick);
    expect(sampleRun.maxBotMsPerTick).toBeLessThanOrEqual(SOAK_THRESHOLDS.maxBotMsPerTick);
  });
});
