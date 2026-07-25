/**
 * RA2 THERMAL / POWER PROBE (v1.0) — on-device measurement harness.
 *
 * WHY THIS EXISTS
 * The iPad gets hot. Heat is SUSTAINED AVERAGE POWER, and on an A17-class
 * tile-based-deferred GPU the power terms are, in order:
 *   1. GPU fill + memory traffic  = pixels x overdraw x fps  (+ the shadow pass,
 *      which is a SECOND full-resolution render every frame)
 *   2. sustained CPU work per second (JS execution + GC)
 *   3. CPU->GPU submission cost per second (draw calls through ANGLE, uniform
 *      churn, texture/buffer uploads)
 *   4. wakeups that stop the SoC racing to idle (rAF chains, timers, network)
 * Every one of those is "per SECOND", not "per frame". This probe therefore
 * reports everything normalised to WALL-CLOCK SECONDS, never per frame, so a
 * change that halves the frame rate shows up as the ~2x win it actually is
 * and a change that shaves 0.2 ms off a frame you draw twice as often shows up
 * as the rounding error it actually is.
 *
 * WHAT IT MEASURES (all against the real engine API, no guessing)
 *   - presented FPS distribution from engine/gfx/Renderer.render() calls
 *     (p50/p95/p99 of inter-present intervals), NOT from a private rAF loop
 *   - rAF wakeup rate vs presented frames: engine/GameAnimationLoop.ts:99-107
 *     returns early from doFrame() when the fps cap says "don't draw", but it
 *     has ALREADY ticked the sim and it re-arms requestAnimationFrame. So a
 *     60 fps cap on a 120 Hz panel still wakes the main thread 120x/second.
 *     `rafFramesPerSec - presentedFps` is exactly that waste.
 *   - CPU ms per wall-second split into: sim (GameTurnManager.doGameTurn),
 *     renderer.update (scene graph + WorldScene.update + batch rebuild),
 *     renderer.render (JS-side draw submission), other-rAF (React/HUD/input),
 *     and timer callbacks (WorldSound's 200 ms pass, the shell REPL poll, ...)
 *   - three.js draw calls / triangles per presented frame AND per second,
 *     with info.autoReset disabled so BOTH scenes (world + UI) and the shadow
 *     pass are counted instead of only the last renderer.render() call
 *   - fill rate: device pixels rasterised per second, split main pass vs
 *     shadow pass, from the real per-scene viewports x the real pixel ratio
 *   - texture memory (walked from the live scene graph + the shadow map)
 *   - CPU throttle canary: a fixed integer workload timed once per bucket.
 *     If the SAME loop takes 25% longer at minute 9 than minute 1, the SoC has
 *     been downclocked — that is thermal throttling, observed from JS.
 *   - GC pressure proxy via FinalizationRegistry (performance.memory does NOT
 *     exist in Safari/WKWebView — see NOTE ON HEAP below)
 *   - jank: intervals over 1.5x / 3x the target, and the worst one
 *
 * NOTE ON HEAP: `performance.memory` is a Chromium extension and is absent in
 * Safari and WKWebView, so absolute heap size and GC time are NOT readable
 * from JS on this device. Two substitutes are provided:
 *   (a) the FinalizationRegistry "GC canary" below. A sentinel object is
 *       allocated and registered every presented frame; JSC processes weak
 *       references on every collection, so a burst of finaliser callbacks
 *       marks a collection. Collections/second x JSC's eden size (a few MB)
 *       is an order-of-magnitude allocation-rate proxy. Use it for A/B
 *       ("this change halved the collection rate"), never as an absolute.
 *   (b) for absolute numbers, attach Safari Web Inspector over USB
 *       (GameViewController.swift sets webView.isInspectable in DEBUG) and use
 *       Timelines -> "JavaScript Allocations". That gives real bytes and real
 *       GC pauses; this probe cannot.
 *
 * USAGE (paste into the Safari inspector console, or eval through the shell
 * REPL in src/shell/iosSeed.ts — that REPL stringifies the result, so use the
 * *Text() variants there):
 *
 *   RA2Thermal.snapshot()                 // instant static read: resolution,
 *                                         // shadow map size, fps cap, budgets
 *   await RA2Thermal.run()                // default 60 s measured + 10 s warmup
 *   await RA2Thermal.runText({ label: 'A-baseline' })
 *   await RA2Thermal.soak({ minutes: 10 })// throttle detection
 *   await RA2Thermal.fillSweep()          // is it fill-bound or CPU-bound?
 *   RA2Thermal.compareText('A-baseline', 'B-shadowLow')
 *   RA2Thermal.list()                     // saved runs (survives app restart)
 *   RA2Thermal.help()
 *
 * Everything it patches is restored in a `finally`, including on exception.
 * `RA2Thermal.detach()` is the emergency undo.
 */
(() => {
  'use strict';

  const VERSION = '1.0';
  const STORE_KEY = 'ra2.thermal.runs';

  // ---------------------------------------------------------------------------
  // THERMAL ACCEPTANCE CRITERIA — "cool as a cucumber" expressed as numbers.
  //
  // Reference point: the sibling C&C Generals port (native ARM64 -> DXVK ->
  // MoltenVK -> Metal) barely warms this iPad. A passively cooled iPad mini
  // stays at "nominal" thermal state indefinitely at roughly 2-3 W of SoC
  // package power; the display alone is ~1 W of that at 50% brightness. So the
  // game itself has about 1.5 W of sustained budget to stay cucumber-cool.
  //
  // Converting 1.5 W into things JS can count:
  //
  //   CPU. One saturated A17 P-core running JIT'd JS costs roughly 1.5-2.5 W.
  //   Take 2.0 W per core-second, i.e. ~2.0 mW per (ms of CPU per second).
  //   Spending 250 ms of CPU per wall-clock second = 25% of one core = ~0.5 W.
  //   That is a third of the budget and is the ceiling below.
  //   For scale: the sim alone at gameSpeed 6 is 60 ticks/s x 1.0-2.1 ms
  //   measured with 6 bots = 60-126 ms/s on a Mac, and an iPad core is slower.
  //
  //   GPU. Simple textured+blended fill on this class of part lands around
  //   2-4 nJ per rasterised pixel once the framebuffer store, the texture
  //   fetches and the palette LUT lookup are included. Take 3 nJ/px =
  //   3.0 mW per (MPix/s). 150 MPix/s => ~0.45 W. That is another third.
  //   For scale: the CURRENT measured configuration is a 2266x1487 backing
  //   store (3.37 MPix) at a 60 fps cap = 202 MPix/s for the colour pass
  //   ALONE, plus a 2048x2048 shadow map re-rendered every frame = another
  //   252 MPix/s of depth-only fill. ~454 MPix/s before a single pixel of
  //   sprite overdraw ~= 1.4 W of GPU on its own. That is the whole budget
  //   spent on fill, which is why the device is hot.
  //
  //   SUBMISSION. Each WebGL draw call crosses JS -> ANGLE -> Metal. Budget
  //   3600 draw calls per second (e.g. 120 calls at 30 fps); beyond that the
  //   ANGLE translation layer becomes a measurable CPU term of its own.
  //
  //   WAKEUPS. Race-to-idle only works if the main thread actually goes idle.
  //   rAF wakeups per second should equal presented frames per second: any
  //   excess is the loop waking the SoC to decide not to draw.
  //
  // Each threshold below is [green, amber]; above amber is red.
  // ---------------------------------------------------------------------------
  const BUDGET = {
    // CPU ms consumed per wall-clock second (sum of every instrumented path).
    cpuMsPerSec: [250, 450],
    // Sim-only slice of the above. Deterministic lockstep forbids changing the
    // tick rate, so this is a floor set by gameSpeed; it is here to make the
    // cost of the lobby's speed setting explicit.
    simMsPerSec: [120, 200],
    // Colour pass, device pixels, excluding overdraw (unmeasurable in WebGL).
    mainMPixPerSec: [110, 180],
    // Shadow depth pass. 1024^2 at 30 fps = 31 MPix/s; 2048^2 at 60 = 252.
    shadowMPixPerSec: [35, 90],
    totalMPixPerSec: [150, 260],
    drawCallsPerSec: [3600, 7000],
    drawCallsPerFrame: [120, 220],
    // Excess rAF wakeups over presented frames, per second.
    wastedWakeupsPerSec: [2, 15],
    // Presented-interval p95 must stay near the target interval.
    frameIntervalP95Ratio: [1.3, 2.0],
    // Percentage of presented intervals over 1.5x target.
    jankPct: [1, 4],
    // FinalizationRegistry collection bursts per second.
    gcPerSec: [4, 10],
    textureMB: [256, 384],
    // Soak criteria (see soak()): percent drift between minute 1 and the last
    // minute. Canary drift is CPU downclock; fps decay is the visible symptom.
    throttleCanaryDriftPct: [5, 12],
    fpsDecayPct: [2, 6],
  };

  // Energy proxy coefficients. ORDER OF MAGNITUDE ONLY. They exist so that a
  // single number can rank two builds when no power meter is available; the
  // absolute mW figure is not trustworthy, the RATIO between two runs on the
  // same device with the same scenario is.
  const ENERGY = {
    mwPerCpuMsPerSec: 2.0,   // 1 core-second/second ~= 2.0 W
    mwPerMPixPerSec: 3.0,    // ~3 nJ per rasterised pixel
    mwPerKDrawCallPerSec: 12.0, // ANGLE/Metal submission, ~12 uJ per call
  };

  // Fixed-work CPU canary. Sized to land near 2 ms on an A17 P-core; the
  // absolute value is irrelevant, only its drift over a soak matters.
  const CANARY_ITERS = 300000;

  // three.js filter constants (the probe has no THREE import).
  const NEAREST_FILTER = 1003;
  const LINEAR_FILTER = 1006;

  const now = () => performance.now();
  const dbg = () => window.__ra2debug;

  function requireGame() {
    const d = dbg();
    if (!d || !d.renderer || !d.gameScreen || !d.gameScreen.gameTurnMgr) {
      throw new Error('[thermal] no running game — start a skirmish and let it reach the world view first');
    }
    if (!d.renderer.renderer) {
      throw new Error('[thermal] engine Renderer has no .renderer (THREE.WebGLRenderer) — engine layout changed');
    }
    return d;
  }

  const pct = (sorted, p) => {
    if (!sorted.length) return null;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[i];
  };
  const median = (arr) => pct([...arr].sort((a, b) => a - b), 50);
  const r2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v);
  const r0 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : v);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function grade(value, [green, amber]) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    if (value <= green) return 'green';
    if (value <= amber) return 'amber';
    return 'RED';
  }

  // ---------------------------------------------------------------------------
  // Mutable measurement state
  // ---------------------------------------------------------------------------
  const S = {
    attached: false,
    running: false,
    restore: [],
    t0: 0,
    // accumulators (reset by resetCounters)
    simMs: 0, simCalls: 0,
    updMs: 0, updCalls: 0,
    rndMs: 0, rndCalls: 0,
    rafMs: 0, rafCallbacks: 0, rafFrames: 0,
    timerMs: 0, timerCalls: 0,
    drawCalls: 0, triangles: 0, points: 0, lines: 0,
    presentGaps: [],
    rafGaps: [],
    lastRafTs: undefined,
    lastPresentAt: 0,
    gcEvents: [],
    canarySink: 0,
    buckets: [],
    errors: [],
    scenario: null,
    gcRegistry: null,
    gcSentinels: 0,
  };

  function resetCounters() {
    S.simMs = 0; S.simCalls = 0;
    S.updMs = 0; S.updCalls = 0;
    S.rndMs = 0; S.rndCalls = 0;
    S.rafMs = 0; S.rafCallbacks = 0; S.rafFrames = 0;
    S.timerMs = 0; S.timerCalls = 0;
    S.drawCalls = 0; S.triangles = 0; S.points = 0; S.lines = 0;
    S.presentGaps = [];
    S.rafGaps = [];
    S.gcEvents = [];
    S.lastPresentAt = 0;
    S.lastRafTs = undefined;
    S.t0 = now();
  }

  // ---------------------------------------------------------------------------
  // Static configuration read (no simulation, no patching)
  // ---------------------------------------------------------------------------
  function readConfig() {
    const d = requireGame();
    const R = d.renderer;
    const gl3 = R.renderer;
    const gl = gl3.getContext();
    const canvas = R.getCanvas();
    const opts = d.generalOptions || {};
    const graphics = opts.graphics || {};

    // Per-scene viewports are in LOGICAL pixels; Renderer.render() multiplies
    // by the pixel ratio internally (three's setViewport applies _pixelRatio).
    const ratio = R.pixelRatio ?? gl3.getPixelRatio();
    const scenes = (R.getScenes?.() ?? []).map((s) => ({
      type: s?.constructor?.name ?? '?',
      x: s?.viewport?.x, y: s?.viewport?.y,
      w: s?.viewport?.width, h: s?.viewport?.height,
      devicePixels: Math.round((s?.viewport?.width ?? 0) * ratio * (s?.viewport?.height ?? 0) * ratio),
    }));
    const mainPixPerFrame = scenes.reduce((sum, s) => sum + s.devicePixels, 0);

    const light = d.worldScene && d.worldScene.directionalLight;
    const shadow = light && light.shadow;
    const shadowOn = !!(light && light.castShadow && gl3.shadowMap.enabled);
    const shadowSize = shadowOn ? (shadow.mapSize?.width ?? 0) : 0;
    const shadowPixPerFrame = shadowOn ? shadowSize * shadowSize : 0;

    const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');

    return {
      probeVersion: VERSION,
      when: new Date().toISOString(),
      ua: navigator.userAgent,
      nativeShell: !!window.__RA2_SHELL__,
      // Filled by the native bridge if GameViewController posts it (see the
      // ProcessInfo.thermalState patch in the accompanying report). Undefined
      // means "no ground truth available, rely on the canary".
      thermalState: window.__RA2_SHELL__?.thermalState ?? null,
      display: {
        cssWidth: Math.round(canvas.clientWidth),
        cssHeight: Math.round(canvas.clientHeight),
        devicePixelRatio: window.devicePixelRatio,
        appliedPixelRatio: ratio,
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
        backingMPix: r2((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6),
      },
      gpu: dbgInfo ? {
        vendor: gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL),
      } : { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER) },
      contextAttributes: gl.getContextAttributes(),
      options: {
        frameLimit: graphics.frameLimit?.value ?? null,
        shadowQuality: graphics.shadows?.value ?? null,
        graphicsSerialized: typeof graphics.serialize === 'function' ? graphics.serialize() : null,
        gameSpeed: d.game?.speed?.value ?? null,
        turnMillis: d.gameScreen.gameTurnMgr.getTurnMillis?.() ?? null,
        simTicksPerSecTarget: r2(1000 / (d.gameScreen.gameTurnMgr.getTurnMillis?.() || 1)),
      },
      scenes,
      fill: {
        mainPixPerFrame,
        shadowEnabled: shadowOn,
        shadowMapSize: shadowSize,
        shadowPixPerFrame,
        // three re-renders the shadow map every frame unless this is false.
        shadowAutoUpdate: shadow ? shadow.autoUpdate : null,
        shadowNeedsUpdate: shadow ? shadow.needsUpdate : null,
      },
      world: {
        simObjects: d.game?.world?.getAllObjects?.().length ?? null,
        currentTick: d.game?.currentTick ?? null,
        worldSceneChildren: d.worldScene?.scene?.children?.length ?? null,
      },
      memory: textureStats(d),
      heapApi: typeof performance.memory === 'undefined'
        ? 'performance.memory ABSENT (Safari/WKWebView) — using the FinalizationRegistry GC canary; for absolute bytes use Safari Web Inspector -> Timelines -> JavaScript Allocations'
        : 'performance.memory present',
      timerQuery: !!(gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query'))
        ? 'GPU timer queries available — real GPU ms per pass is measurable'
        : 'no EXT_disjoint_timer_query — GPU time is NOT directly measurable; use fillSweep() to infer fill-boundedness',
    };
  }

  // ---------------------------------------------------------------------------
  // Texture memory: walk the live scene graph + the shadow map. three's
  // info.memory.textures is a COUNT, not bytes, so bytes are estimated from
  // each texture's image dimensions.
  // ---------------------------------------------------------------------------
  function textureStats(d) {
    const seen = new Set();
    let bytes = 0;
    let biggest = [];

    const addTexture = (t, tag) => {
      if (!t || !t.isTexture || seen.has(t)) return;
      seen.add(t);
      const img = t.image || t.source?.data || {};
      const w = img.width || 0;
      const h = img.height || 0;
      if (!w || !h) return;
      // Everything in this engine is 8-bit RGBA (TextureAtlas builds
      // THREE.DataTexture with RGBAFormat) or a depth target.
      let b = w * h * 4;
      const mipmapped = t.generateMipmaps && t.minFilter !== NEAREST_FILTER && t.minFilter !== LINEAR_FILTER;
      if (mipmapped) b = Math.round(b * 4 / 3);
      bytes += b;
      biggest.push({ tag, w, h, mb: r2(b / 1048576) });
    };

    const addMaterial = (m, tag) => {
      if (!m) return;
      for (const key of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'specularMap', 'lightMap', 'aoMap', 'bumpMap', 'envMap']) {
        addTexture(m[key], `${tag}.${key}`);
      }
      if (m.uniforms) {
        for (const name of Object.keys(m.uniforms)) {
          const v = m.uniforms[name]?.value;
          if (v && v.isTexture) addTexture(v, `${tag}.u_${name}`);
        }
      }
    };

    for (const scene of (d.renderer.getScenes?.() ?? [])) {
      const root = scene?.scene;
      if (!root || typeof root.traverse !== 'function') continue;
      const sceneTag = scene?.constructor?.name ?? 'scene';
      root.traverse((obj) => {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm, i) => addMaterial(mm, `${sceneTag}:${obj.type}[${i}]`));
        else addMaterial(m, `${sceneTag}:${obj.type}`);
      });
    }

    const shadowMap = d.worldScene?.directionalLight?.shadow?.map;
    let shadowMB = 0;
    if (shadowMap && shadowMap.width) {
      // Depth target: 4 bytes/texel is the conservative estimate (D32 or
      // RGBA8-packed depth); a 8192^2 map would be 268 MB, which is exactly
      // why WorldScene clamps to 2048 on coarse pointers.
      shadowMB = r2((shadowMap.width * shadowMap.height * 4) / 1048576);
    }

    biggest.sort((a, b) => b.mb - a.mb);
    return {
      sceneTextureCount: seen.size,
      sceneTextureMB: r2(bytes / 1048576),
      shadowMapMB: shadowMB,
      totalMB: r2(bytes / 1048576 + shadowMB),
      glTextureCount: d.renderer.renderer.info.memory.textures,
      glGeometryCount: d.renderer.renderer.info.memory.geometries,
      programCount: d.renderer.renderer.info.programs?.length ?? null,
      largest: biggest.slice(0, 8),
    };
  }

  // ---------------------------------------------------------------------------
  // Instrumentation
  // ---------------------------------------------------------------------------
  function attach() {
    if (S.attached) return;
    const d = requireGame();
    const R = d.renderer;
    const gl3 = R.renderer;
    const turnMgr = d.gameScreen.gameTurnMgr;
    S.restore = [];

    // three resets renderer.info at the START of every WebGLRenderer.render()
    // call. Renderer.render() (engine/gfx/Renderer.ts:142-152) calls it once
    // per scene, so with autoReset on, info would only ever describe the LAST
    // scene. Take manual control and reset once per presented frame.
    const prevAutoReset = gl3.info.autoReset;
    gl3.info.autoReset = false;
    S.restore.push(() => { gl3.info.autoReset = prevAutoReset; });

    // --- sim ---------------------------------------------------------------
    const origTurn = turnMgr.doGameTurn;
    turnMgr.doGameTurn = function patchedDoGameTurn(timestamp) {
      const t = now();
      S.simCalls++;
      try {
        return origTurn.call(this, timestamp);
      } finally {
        S.simMs += now() - t;
      }
    };
    S.restore.push(() => { turnMgr.doGameTurn = origTurn; });

    // --- renderer.update (scene graph, batches, WorldScene.update) ----------
    const origUpdate = R.update;
    R.update = function patchedUpdate(...args) {
      if (S.scenario) {
        try { S.scenario(now()); } catch (e) { S.errors.push('scenario: ' + (e && e.message)); }
      }
      const t = now();
      S.updCalls++;
      try {
        return origUpdate.apply(this, args);
      } finally {
        S.updMs += now() - t;
      }
    };
    S.restore.push(() => { R.update = origUpdate; });

    // --- renderer.render (draw submission) + presented-frame clock ----------
    const origRender = R.render;
    R.render = function patchedRender(...args) {
      gl3.info.reset();
      const t = now();
      try {
        return origRender.apply(this, args);
      } finally {
        const t1 = now();
        S.rndMs += t1 - t;
        S.rndCalls++;
        const info = gl3.info.render;
        S.drawCalls += info.calls;
        S.triangles += info.triangles;
        S.points += info.points;
        S.lines += info.lines;
        if (S.lastPresentAt) S.presentGaps.push(t1 - S.lastPresentAt);
        S.lastPresentAt = t1;
        if (S.gcRegistry) {
          const sentinel = { f: S.rndCalls };
          S.gcSentinels++;
          S.gcRegistry.register(sentinel, S.rndCalls);
        }
      }
    };
    S.restore.push(() => { R.render = origRender; });

    // --- rAF wakeups -------------------------------------------------------
    // Counts EVERY animation-frame callback, including the ones where
    // GameAnimationLoop.doFrame ticks the sim and then returns early because
    // of the fps cap. rafFrames (unique timestamps) vs presented frames is the
    // wasted-wakeup number.
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function patchedRaf(cb) {
      return origRaf((ts) => {
        S.rafCallbacks++;
        if (ts !== S.lastRafTs) {
          if (S.lastRafTs !== undefined) S.rafGaps.push(ts - S.lastRafTs);
          S.lastRafTs = ts;
          S.rafFrames++;
        }
        const t = now();
        try {
          return cb(ts);
        } finally {
          S.rafMs += now() - t;
        }
      });
    };
    S.restore.push(() => { window.requestAnimationFrame = origRaf; });

    // --- timer callbacks (WorldSound's 200 ms pass, REPL poll, React, ...) --
    // Wrapping the callback costs one closure per scheduled timer and adds NO
    // extra wakeups, unlike an occupancy sampler.
    const origSetTimeout = window.setTimeout;
    const origSetInterval = window.setInterval;
    const wrapTimerFn = (fn) => (handler, delay, ...rest) => {
      if (typeof handler !== 'function') return fn(handler, delay, ...rest);
      return fn(function patchedTimerCb(...args) {
        const t = now();
        S.timerCalls++;
        try {
          return handler.apply(this, args);
        } finally {
          S.timerMs += now() - t;
        }
      }, delay, ...rest);
    };
    window.setTimeout = wrapTimerFn(origSetTimeout);
    window.setInterval = wrapTimerFn(origSetInterval);
    S.restore.push(() => { window.setTimeout = origSetTimeout; window.setInterval = origSetInterval; });

    // --- GC canary ---------------------------------------------------------
    if (typeof FinalizationRegistry === 'function') {
      S.gcRegistry = new FinalizationRegistry(() => { S.gcEvents.push(now()); });
      S.restore.push(() => { S.gcRegistry = null; });
    }

    // --- error capture -----------------------------------------------------
    const onError = (e) => S.errors.push('window.onerror: ' + (e.message || e));
    const onRejection = (e) => S.errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    S.restore.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });

    S.attached = true;
    resetCounters();
  }

  function detach() {
    S.scenario = null;
    while (S.restore.length) {
      const undo = S.restore.pop();
      try { undo(); } catch (e) { console.warn('[thermal] restore failed', e); }
    }
    S.attached = false;
  }

  // ---------------------------------------------------------------------------
  // CPU throttle canary. Fixed integer work; the result is stored so JSC
  // cannot dead-code it away. Take the MINIMUM of three runs: the minimum is
  // the sample least contaminated by scheduling, so a rise in the minimum is a
  // clock change, not noise.
  // ---------------------------------------------------------------------------
  // Run the canary until its minimum stops improving: JSC needs several
  // invocations to tier the loop up to FTL, and an un-tiered first sample
  // would make the whole run look like a 3x "speed-up".
  function calibrateCanary(rounds = 6) {
    let best = Infinity;
    for (let i = 0; i < rounds; i++) {
      const cur = canaryMs();
      // Only the tail counts: the early rounds are the interpreter and the
      // baseline JIT, not the steady-state clock.
      if (i >= rounds - 2) best = Math.min(best, cur);
    }
    return best;
  }

  function canaryMs() {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t = now();
      let x = run + 1;
      for (let i = 1; i <= CANARY_ITERS; i++) {
        x = (x + Math.imul(i, 2654435761)) >>> 0;
        x ^= x >>> 13;
      }
      const dt = now() - t;
      S.canarySink = (S.canarySink + x) >>> 0;
      if (dt < best) best = dt;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Scripted camera scenario. Camera pan/zoom is RENDER-side only (CameraPan
  // feeds WorldScene.updateCamera), so this cannot perturb the lockstep sim.
  // It exists so the A/B protocol shows the same pixels in both runs:
  // a fixed 20 s pan loop across the map at a fixed zoom, driven by ELAPSED
  // TIME rather than frame count so it is identical at 30 and 60 fps.
  // ---------------------------------------------------------------------------
  function makeScenario(kind) {
    if (kind === 'static' || kind === false) return null;
    const d = requireGame();
    const ws = d.worldScene;
    const pan = ws?.cameraPan;
    const zoomCtl = ws?.cameraZoom;
    if (!pan || typeof pan.getPanLimits !== 'function') return null;
    let limits;
    try { limits = pan.getPanLimits(); } catch { limits = null; }
    if (!limits || !isFinite(limits.width)) return null;

    const startedAt = now();
    const PERIOD_MS = 20000;
    // Four corners of the inner 60% of the legal pan area, so the path never
    // clamps (clamping would make the two runs differ near the map edge).
    const fx = [0.2, 0.8, 0.8, 0.2];
    const fy = [0.2, 0.2, 0.8, 0.8];
    const fixedZoom = zoomCtl ? zoomCtl.getZoom() : 1;

    return function driveCamera(t) {
      if (zoomCtl) zoomCtl.setZoom(fixedZoom);
      const phase = ((t - startedAt) % PERIOD_MS) / PERIOD_MS;
      const leg = Math.floor(phase * 4);
      const legPhase = phase * 4 - leg;
      const next = (leg + 1) % 4;
      const ax = fx[leg] + (fx[next] - fx[leg]) * legPhase;
      const ay = fy[leg] + (fy[next] - fy[leg]) * legPhase;
      pan.setPan({
        x: limits.x + limits.width * ax,
        y: limits.y + limits.height * ay,
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Bucketing: one sample per second, so the report can show drift over time
  // without keeping per-frame arrays.
  // ---------------------------------------------------------------------------
  // A single collection wakes every registered sentinel, so callbacks arrive in
  // clusters. Cluster by 50 ms to count COLLECTIONS rather than callbacks.
  function countGcBursts(events) {
    if (!events.length) return 0;
    const sorted = [...events].sort((a, b) => a - b);
    let bursts = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > 50) bursts++;
    }
    return bursts;
  }

  // ---------------------------------------------------------------------------
  // Core measurement run
  // ---------------------------------------------------------------------------
  async function run(opts = {}) {
    const seconds = opts.seconds ?? 60;
    const warmupSeconds = opts.warmupSeconds ?? 10;
    const label = opts.label ?? `run-${new Date().toISOString().slice(11, 19)}`;
    const scenarioKind = opts.scenario ?? 'pan';
    const canaryEverySec = opts.canaryEverySec ?? 15;

    if (S.running) throw new Error('[thermal] a run is already in progress');
    const config = readConfig();
    const wasAttached = S.attached;
    if (!wasAttached) attach();
    S.running = true;
    S.buckets = [];
    S.errors = [];

    let coldCanary = 0;

    try {
      S.scenario = makeScenario(scenarioKind);
      if (scenarioKind !== 'static' && !S.scenario) {
        S.errors.push('scenario requested but pan limits unavailable — ran with a free camera');
      }

      // Warm-up: shader compilation, atlas uploads, JIT tiering and the first
      // few GCs all land here and would otherwise poison the sample.
      console.log(`[thermal] warm-up ${warmupSeconds}s ...`);
      await sleep(warmupSeconds * 1000);

      // Reference clock speed, taken warm-but-not-yet-soaked, and taken via
      // calibrateCanary so the canary's own code is fully JIT-tiered before it
      // is used as a clock. Every later canary is compared against this one.
      coldCanary = calibrateCanary();
      resetCounters();
      const startedAt = now();
      let lastBucketAt = startedAt;
      let lastCanaryAt = startedAt;
      let prev = snapshotAccumulators();
      console.log(`[thermal] measuring ${seconds}s (label="${label}") ...`);

      while ((now() - startedAt) / 1000 < seconds) {
        await sleep(250);
        const t = now();
        if (t - lastBucketAt >= 1000) {
          const cur = snapshotAccumulators();
          const delta = diffAccumulators(prev, cur, (t - lastBucketAt) / 1000);
          prev = cur;
          lastBucketAt = t;
          S.buckets.push(delta);
          if (t - lastCanaryAt >= canaryEverySec * 1000) {
            lastCanaryAt = t;
            delta.canaryMs = r2(canaryMs());
          }
        }
      }

      const elapsedSec = (now() - startedAt) / 1000;
      const totals = snapshotAccumulators();
      const report = summarise({
        label, config, totals, elapsedSec, coldCanary,
        warmCanary: canaryMs(),
        scenario: scenarioKind,
      });
      report.memoryAfter = textureStats(requireGame());
      printReport(report);
      saveRun(report);
      return report;
    } finally {
      S.running = false;
      S.scenario = null;
      if (!wasAttached) detach();
    }
  }

  function snapshotAccumulators() {
    return {
      at: now(),
      simMs: S.simMs, simCalls: S.simCalls,
      updMs: S.updMs, updCalls: S.updCalls,
      rndMs: S.rndMs, rndCalls: S.rndCalls,
      rafMs: S.rafMs, rafCallbacks: S.rafCallbacks, rafFrames: S.rafFrames,
      timerMs: S.timerMs, timerCalls: S.timerCalls,
      drawCalls: S.drawCalls, triangles: S.triangles,
      presentGaps: S.presentGaps.length,
      gcEvents: S.gcEvents.length,
    };
  }

  function diffAccumulators(a, b, sec) {
    const gaps = [...S.presentGaps].slice(a.presentGaps).sort((x, y) => x - y);
    return {
      t: r2((b.at - S.t0) / 1000),
      fps: r2((b.rndCalls - a.rndCalls) / sec),
      rafFps: r2((b.rafFrames - a.rafFrames) / sec),
      simTps: r2((b.simCalls - a.simCalls) / sec),
      cpuMsPerSec: r2(((b.rafMs - a.rafMs) + (b.timerMs - a.timerMs)) / sec),
      simMsPerSec: r2((b.simMs - a.simMs) / sec),
      updMsPerSec: r2((b.updMs - a.updMs) / sec),
      rndMsPerSec: r2((b.rndMs - a.rndMs) / sec),
      drawCallsPerSec: r0((b.drawCalls - a.drawCalls) / sec),
      p50Gap: r2(pct(gaps, 50)),
      p95Gap: r2(pct(gaps, 95)),
      gcBursts: countGcBursts(S.gcEvents.slice(a.gcEvents)),
      canaryMs: null,
    };
  }

  function summarise({ label, config, totals, elapsedSec, coldCanary, warmCanary, scenario }) {
    const gaps = [...S.presentGaps].sort((a, b) => a - b);
    const rafGaps = [...S.rafGaps].sort((a, b) => a - b);
    const presentedFps = totals.rndCalls / elapsedSec;
    const rafFps = totals.rafFrames / elapsedSec;
    const targetFps = config.options.frameLimit || presentedFps || 60;
    const targetInterval = 1000 / targetFps;

    const cpu = {
      totalMsPerSec: r2((totals.rafMs + totals.timerMs) / elapsedSec),
      simMsPerSec: r2(totals.simMs / elapsedSec),
      rendererUpdateMsPerSec: r2(totals.updMs / elapsedSec),
      rendererRenderMsPerSec: r2(totals.rndMs / elapsedSec),
      otherRafMsPerSec: r2(Math.max(0, totals.rafMs - totals.simMs - totals.updMs - totals.rndMs) / elapsedSec),
      timerMsPerSec: r2(totals.timerMs / elapsedSec),
      simMsPerTick: r2(totals.simMs / Math.max(1, totals.simCalls)),
      rendererUpdateMsPerFrame: r2(totals.updMs / Math.max(1, totals.updCalls)),
      rendererRenderMsPerFrame: r2(totals.rndMs / Math.max(1, totals.rndCalls)),
    };

    const mainMPixPerSec = (config.fill.mainPixPerFrame * presentedFps) / 1e6;
    const shadowMPixPerSec = (config.fill.shadowPixPerFrame * presentedFps) / 1e6;
    const totalMPixPerSec = mainMPixPerSec + shadowMPixPerSec;
    const drawCallsPerFrame = totals.drawCalls / Math.max(1, totals.rndCalls);
    const drawCallsPerSec = totals.drawCalls / elapsedSec;

    const jankCount = gaps.filter((g) => g > targetInterval * 1.5).length;
    const severeJank = gaps.filter((g) => g > targetInterval * 3).length;

    const energyMw = r0(
      cpu.totalMsPerSec * ENERGY.mwPerCpuMsPerSec +
      totalMPixPerSec * ENERGY.mwPerMPixPerSec +
      (drawCallsPerSec / 1000) * ENERGY.mwPerKDrawCallPerSec
    );

    const wastedWakeups = Math.max(0, rafFps - presentedFps);
    const gcBursts = countGcBursts(S.gcEvents);

    const metrics = {
      elapsedSec: r2(elapsedSec),
      presentedFps: r2(presentedFps),
      rafFramesPerSec: r2(rafFps),
      rafCallbacksPerSec: r2(totals.rafCallbacks / elapsedSec),
      wastedWakeupsPerSec: r2(wastedWakeups),
      simTicksPerSec: r2(totals.simCalls / elapsedSec),
      frameInterval: {
        targetMs: r2(targetInterval),
        p50: r2(pct(gaps, 50)), p95: r2(pct(gaps, 95)), p99: r2(pct(gaps, 99)),
        max: r2(gaps.length ? gaps[gaps.length - 1] : null),
        p95Ratio: r2(pct(gaps, 95) / targetInterval),
      },
      rafInterval: { p50: r2(pct(rafGaps, 50)), p95: r2(pct(rafGaps, 95)) },
      cpu,
      gpu: {
        drawCallsPerFrame: r2(drawCallsPerFrame),
        drawCallsPerSec: r0(drawCallsPerSec),
        trianglesPerFrame: r0(totals.triangles / Math.max(1, totals.rndCalls)),
        trianglesPerSec: r0(totals.triangles / elapsedSec),
        mainMPixPerSec: r2(mainMPixPerSec),
        shadowMPixPerSec: r2(shadowMPixPerSec),
        totalMPixPerSec: r2(totalMPixPerSec),
        note: 'fill EXCLUDES sprite overdraw, which WebGL cannot report. Use fillSweep() to test whether the frame is fill-bound.',
      },
      jank: {
        over1_5x: jankCount,
        over3x: severeJank,
        jankPct: r2((100 * jankCount) / Math.max(1, gaps.length)),
      },
      gc: {
        bursts: gcBursts,
        burstsPerSec: r2(gcBursts / elapsedSec),
        sentinelsRegistered: S.gcSentinels,
        note: typeof FinalizationRegistry === 'function'
          ? 'collection-frequency proxy only; multiply by JSC eden size (~4-16 MB) for an order-of-magnitude allocation rate'
          : 'FinalizationRegistry unavailable — no GC signal',
      },
      throttleCanary: {
        coldMs: r2(coldCanary),
        warmMs: r2(warmCanary),
        driftPct: r2(((warmCanary - coldCanary) / coldCanary) * 100),
      },
      energyProxyMw: energyMw,
    };

    const verdict = {
      cpuMsPerSec: grade(cpu.totalMsPerSec, BUDGET.cpuMsPerSec),
      simMsPerSec: grade(cpu.simMsPerSec, BUDGET.simMsPerSec),
      mainMPixPerSec: grade(mainMPixPerSec, BUDGET.mainMPixPerSec),
      shadowMPixPerSec: grade(shadowMPixPerSec, BUDGET.shadowMPixPerSec),
      totalMPixPerSec: grade(totalMPixPerSec, BUDGET.totalMPixPerSec),
      drawCallsPerSec: grade(drawCallsPerSec, BUDGET.drawCallsPerSec),
      drawCallsPerFrame: grade(drawCallsPerFrame, BUDGET.drawCallsPerFrame),
      wastedWakeupsPerSec: grade(wastedWakeups, BUDGET.wastedWakeupsPerSec),
      frameIntervalP95Ratio: grade(metrics.frameInterval.p95Ratio, BUDGET.frameIntervalP95Ratio),
      jankPct: grade(metrics.jank.jankPct, BUDGET.jankPct),
      gcPerSec: grade(metrics.gc.burstsPerSec, BUDGET.gcPerSec),
      textureMB: grade(config.memory.totalMB, BUDGET.textureMB),
      throttleCanaryDriftPct: grade(metrics.throttleCanary.driftPct, BUDGET.throttleCanaryDriftPct),
    };
    const reds = Object.entries(verdict).filter(([, v]) => v === 'RED').map(([k]) => k);
    const ambers = Object.entries(verdict).filter(([, v]) => v === 'amber').map(([k]) => k);

    return {
      label, probeVersion: VERSION, scenario,
      config, metrics, verdict,
      overall: reds.length ? 'RED' : ambers.length ? 'AMBER' : 'GREEN',
      reds, ambers,
      buckets: S.buckets,
      errors: S.errors.slice(0, 40),
    };
  }

  function printReport(report) {
    const m = report.metrics;
    console.log(`[thermal] ${report.label} — ${report.overall} (energy proxy ${m.energyProxyMw} mW-equivalent)`);
    console.table([
      { metric: 'CPU ms / wall second (all)', value: m.cpu.totalMsPerSec, budget: BUDGET.cpuMsPerSec.join(' / '), verdict: report.verdict.cpuMsPerSec },
      { metric: '  sim (doGameTurn)', value: m.cpu.simMsPerSec, budget: BUDGET.simMsPerSec.join(' / '), verdict: report.verdict.simMsPerSec },
      { metric: '  renderer.update', value: m.cpu.rendererUpdateMsPerSec, budget: '', verdict: '' },
      { metric: '  renderer.render (submit)', value: m.cpu.rendererRenderMsPerSec, budget: '', verdict: '' },
      { metric: '  other rAF (UI/input)', value: m.cpu.otherRafMsPerSec, budget: '', verdict: '' },
      { metric: '  timer callbacks', value: m.cpu.timerMsPerSec, budget: '', verdict: '' },
      { metric: 'presented fps', value: m.presentedFps, budget: `cap ${report.config.options.frameLimit}`, verdict: '' },
      { metric: 'rAF wakeups / s', value: m.rafFramesPerSec, budget: '', verdict: '' },
      { metric: 'wasted wakeups / s', value: m.wastedWakeupsPerSec, budget: BUDGET.wastedWakeupsPerSec.join(' / '), verdict: report.verdict.wastedWakeupsPerSec },
      { metric: 'sim ticks / s', value: m.simTicksPerSec, budget: '', verdict: '' },
      { metric: 'frame interval p95 (ms)', value: m.frameInterval.p95, budget: `target ${m.frameInterval.targetMs}`, verdict: report.verdict.frameIntervalP95Ratio },
      { metric: 'jank % (>1.5x target)', value: m.jank.jankPct, budget: BUDGET.jankPct.join(' / '), verdict: report.verdict.jankPct },
      { metric: 'main pass MPix/s', value: m.gpu.mainMPixPerSec, budget: BUDGET.mainMPixPerSec.join(' / '), verdict: report.verdict.mainMPixPerSec },
      { metric: 'shadow pass MPix/s', value: m.gpu.shadowMPixPerSec, budget: BUDGET.shadowMPixPerSec.join(' / '), verdict: report.verdict.shadowMPixPerSec },
      { metric: 'total MPix/s', value: m.gpu.totalMPixPerSec, budget: BUDGET.totalMPixPerSec.join(' / '), verdict: report.verdict.totalMPixPerSec },
      { metric: 'draw calls / frame', value: m.gpu.drawCallsPerFrame, budget: BUDGET.drawCallsPerFrame.join(' / '), verdict: report.verdict.drawCallsPerFrame },
      { metric: 'draw calls / s', value: m.gpu.drawCallsPerSec, budget: BUDGET.drawCallsPerSec.join(' / '), verdict: report.verdict.drawCallsPerSec },
      { metric: 'triangles / frame', value: m.gpu.trianglesPerFrame, budget: '', verdict: '' },
      { metric: 'texture MB (scene+shadow)', value: report.config.memory.totalMB, budget: BUDGET.textureMB.join(' / '), verdict: report.verdict.textureMB },
      { metric: 'GC bursts / s', value: m.gc.burstsPerSec, budget: BUDGET.gcPerSec.join(' / '), verdict: report.verdict.gcPerSec },
      { metric: 'throttle canary drift %', value: m.throttleCanary.driftPct, budget: BUDGET.throttleCanaryDriftPct.join(' / '), verdict: report.verdict.throttleCanaryDriftPct },
    ]);
    if (report.reds.length) console.log('[thermal] OVER BUDGET:', report.reds.join(', '));
    if (report.errors.length) console.log('[thermal] errors during run:', report.errors);
  }

  // ---------------------------------------------------------------------------
  // 10-minute soak: same measurement, but the report focuses on DRIFT.
  // Thermal throttling from JS looks like: constant workload, constant draw
  // calls, but the CPU canary slows down and/or presented fps decays.
  // ---------------------------------------------------------------------------
  async function soak(opts = {}) {
    const minutes = opts.minutes ?? 10;
    const report = await run({
      seconds: minutes * 60,
      warmupSeconds: opts.warmupSeconds ?? 30,
      label: opts.label ?? `soak-${minutes}m`,
      scenario: opts.scenario ?? 'pan',
      canaryEverySec: opts.canaryEverySec ?? 30,
    });

    const buckets = report.buckets;
    const per = Math.max(1, Math.floor(buckets.length / minutes));
    const firstMinute = buckets.slice(0, per);
    const lastMinute = buckets.slice(-per);
    const canaries = buckets.filter((b) => b.canaryMs !== null);
    const firstCanary = canaries.length ? canaries[0].canaryMs : null;
    const lastCanary = canaries.length ? canaries[canaries.length - 1].canaryMs : null;

    const fpsFirst = median(firstMinute.map((b) => b.fps));
    const fpsLast = median(lastMinute.map((b) => b.fps));
    const cpuFirst = median(firstMinute.map((b) => b.cpuMsPerSec));
    const cpuLast = median(lastMinute.map((b) => b.cpuMsPerSec));

    report.soak = {
      minutes,
      fpsFirstMinute: r2(fpsFirst),
      fpsLastMinute: r2(fpsLast),
      fpsDecayPct: r2(((fpsFirst - fpsLast) / fpsFirst) * 100),
      cpuMsPerSecFirstMinute: r2(cpuFirst),
      cpuMsPerSecLastMinute: r2(cpuLast),
      canaryFirstMs: r2(firstCanary),
      canaryLastMs: r2(lastCanary),
      canaryDriftPct: firstCanary ? r2(((lastCanary - firstCanary) / firstCanary) * 100) : null,
      thermalStateNative: window.__RA2_SHELL__?.thermalState ?? null,
      verdict: {
        fpsDecayPct: grade(((fpsFirst - fpsLast) / fpsFirst) * 100, BUDGET.fpsDecayPct),
        canaryDriftPct: firstCanary ? grade(((lastCanary - firstCanary) / firstCanary) * 100, BUDGET.throttleCanaryDriftPct) : 'n/a',
      },
      interpretation:
        'canary drift > ~5% with flat draw calls = the SoC was downclocked, i.e. the device is thermally throttling. ' +
        'fps decay with a flat canary = the GPU is throttling (or the sim grew). ' +
        'Both flat for 10 minutes at these budgets = cucumber.',
    };
    console.log('[thermal] soak drift');
    console.table([report.soak]);
    saveRun(report);
    return report;
  }

  // ---------------------------------------------------------------------------
  // fillSweep: the only way to tell fill-bound from CPU-bound without GPU timer
  // queries. Uncap the frame limit, then measure achievable fps at three pixel
  // ratios. If fps scales ~1/pixels, the frame is FILL-bound and resolution or
  // overdraw is the lever. If fps is flat, it is CPU-bound and resolution
  // changes will not help the heat.
  //
  // This deliberately runs the device uncapped for a few seconds per step —
  // keep it short and do not run it back-to-back with a soak.
  // ---------------------------------------------------------------------------
  async function fillSweep(opts = {}) {
    const perStepSec = opts.perStepSec ?? 6;
    const ratios = opts.ratios ?? [1, 1.5, 2];
    const d = requireGame();
    const R = d.renderer;
    const graphics = d.generalOptions?.graphics;
    const origLimit = graphics?.frameLimit?.value;
    const origRatio = R.pixelRatio;
    const wasAttached = S.attached;
    if (!wasAttached) attach();

    const rows = [];
    try {
      if (graphics?.frameLimit) graphics.frameLimit.value = 0; // uncapped
      for (const ratio of ratios) {
        R.setPixelRatio(ratio);
        await sleep(1500); // let the resize settle and the first frames warm
        resetCounters();
        const t0 = now();
        await sleep(perStepSec * 1000);
        const sec = (now() - t0) / 1000;
        const gl = R.renderer.getContext();
        const pixels = gl.drawingBufferWidth * gl.drawingBufferHeight;
        const fps = S.rndCalls / sec;
        rows.push({
          pixelRatio: ratio,
          backingMPix: r2(pixels / 1e6),
          uncappedFps: r2(fps),
          mPixPerSec: r2((pixels * fps) / 1e6),
          cpuMsPerSec: r2((S.rafMs + S.timerMs) / sec),
          rendererRenderMsPerFrame: r2(S.rndMs / Math.max(1, S.rndCalls)),
          drawCallsPerFrame: r2(S.drawCalls / Math.max(1, S.rndCalls)),
        });
      }
    } finally {
      R.setPixelRatio(origRatio);
      if (graphics?.frameLimit && origLimit !== undefined) graphics.frameLimit.value = origLimit;
      if (!wasAttached) detach();
    }

    // If MPix/s is roughly constant across ratios, the GPU is saturated at a
    // fixed fill rate => fill-bound. If fps is constant instead, => CPU-bound.
    const mpix = rows.map((r) => r.mPixPerSec);
    const fpsv = rows.map((r) => r.uncappedFps);
    const spread = (a) => (Math.max(...a) - Math.min(...a)) / Math.max(...a);
    const diagnosis = spread(mpix) < 0.2 ? 'FILL-BOUND (constant MPix/s across resolutions) — resolution and overdraw are the lever'
      : spread(fpsv) < 0.15 ? 'CPU-BOUND (fps flat across resolutions) — resolution changes will not cool the device; cut work per second'
        : 'MIXED — both terms matter; cut the larger one first';
    console.log('[thermal] fill sweep:', diagnosis);
    console.table(rows);
    return { rows, diagnosis };
  }

  // ---------------------------------------------------------------------------
  // Optional diagnostic: total main-thread occupancy, i.e. how much CPU is
  // burned by work this probe does NOT wrap (promise continuations, GC pauses,
  // layout, style recalc). A self-rescheduling 20 ms timer measures its own
  // LATENESS; a timer that asked for 20 ms and got 34 ms was blocked for 14 ms.
  //
  // A MessageChannel ping-pong would sample far more finely, but it never lets
  // the event loop go idle and so inflates the very power being measured. This
  // costs 50 wakeups/second, which is still enough to matter — diagnostic only,
  // never inside a headline A/B run.
  // ---------------------------------------------------------------------------
  async function occupancy(seconds = 10) {
    console.warn('[thermal] occupancy() adds 50 wakeups/s and inflates power; diagnostic only');
    const PERIOD = 20;
    const late = [];
    let stop = false;
    const tick = () => {
      const asked = now();
      setTimeout(() => {
        const got = now();
        late.push(got - asked - PERIOD);
        if (!stop) tick();
      }, PERIOD);
    };
    tick();
    await sleep(seconds * 1000);
    stop = true;
    const sorted = [...late].sort((a, b) => a - b);
    const blocked = late.reduce((sum, g) => sum + Math.max(0, g), 0);
    const result = {
      samples: late.length,
      p50LatenessMs: r2(pct(sorted, 50)),
      p95LatenessMs: r2(pct(sorted, 95)),
      maxLatenessMs: r2(sorted.length ? sorted[sorted.length - 1] : null),
      estimatedBusyMsPerSec: r2(blocked / seconds),
      note: 'lower bound on total main-thread busy time (a 20 ms sampler cannot see blocks shorter than its own period). Compare with cpu.totalMsPerSec: a large excess means significant work outside rAF and timers, e.g. promise continuations or GC.',
    };
    console.table([result]);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Run store + A/B comparison
  // ---------------------------------------------------------------------------
  function slimRun(report) {
    return {
      label: report.label, when: report.config.when, overall: report.overall,
      probeVersion: report.probeVersion, scenario: report.scenario,
      options: report.config.options,
      display: report.config.display,
      fill: report.config.fill,
      metrics: report.metrics,
      soak: report.soak ?? null,
      textureMB: report.config.memory.totalMB,
    };
  }

  function saveRun(report) {
    try {
      const runs = loadRuns();
      runs.push(slimRun(report));
      while (runs.length > 20) runs.shift();
      localStorage.setItem(STORE_KEY, JSON.stringify(runs));
    } catch (e) {
      console.warn('[thermal] could not persist run', e);
    }
    (window.__ra2thermalRuns ??= []).push(report);
  }

  function loadRuns() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function findRun(labelOrObject) {
    if (labelOrObject && typeof labelOrObject === 'object') return slimRun(labelOrObject);
    const runs = loadRuns();
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].label === labelOrObject) return runs[i];
    }
    throw new Error(`[thermal] no saved run labelled "${labelOrObject}" — RA2Thermal.list()`);
  }

  function compare(aRef, bRef) {
    const a = findRun(aRef);
    const b = findRun(bRef);
    const pick = (r) => ({
      energyProxyMw: r.metrics.energyProxyMw,
      cpuMsPerSec: r.metrics.cpu.totalMsPerSec,
      simMsPerSec: r.metrics.cpu.simMsPerSec,
      updateMsPerSec: r.metrics.cpu.rendererUpdateMsPerSec,
      renderMsPerSec: r.metrics.cpu.rendererRenderMsPerSec,
      presentedFps: r.metrics.presentedFps,
      rafFramesPerSec: r.metrics.rafFramesPerSec,
      totalMPixPerSec: r.metrics.gpu.totalMPixPerSec,
      shadowMPixPerSec: r.metrics.gpu.shadowMPixPerSec,
      drawCallsPerSec: r.metrics.gpu.drawCallsPerSec,
      gcPerSec: r.metrics.gc.burstsPerSec,
      p95FrameMs: r.metrics.frameInterval.p95,
    });
    const A = pick(a);
    const B = pick(b);
    const rows = Object.keys(A).map((k) => ({
      metric: k,
      A: A[k], B: B[k],
      delta: r2(B[k] - A[k]),
      pct: A[k] ? r2(((B[k] - A[k]) / A[k]) * 100) : null,
    }));

    // Configuration drift check: an A/B is only attributable if these match.
    const held = ['frameLimit', 'shadowQuality', 'gameSpeed', 'turnMillis'];
    const drift = held.filter((k) => a.options?.[k] !== b.options?.[k])
      .map((k) => `${k}: ${a.options?.[k]} -> ${b.options?.[k]}`);
    const resDrift = a.display?.appliedPixelRatio !== b.display?.appliedPixelRatio
      ? [`appliedPixelRatio: ${a.display?.appliedPixelRatio} -> ${b.display?.appliedPixelRatio}`] : [];
    const scenarioDrift = a.scenario !== b.scenario ? [`scenario: ${a.scenario} -> ${b.scenario}`] : [];

    console.log(`[thermal] A="${a.label}" vs B="${b.label}"`);
    console.table(rows);
    const changed = [...drift, ...resDrift, ...scenarioDrift];
    if (changed.length) {
      console.log('[thermal] configuration changed between runs (this is the change under test, or a confound):', changed);
    }
    const verdict = B.energyProxyMw < A.energyProxyMw
      ? `B is ${r2(100 * (1 - B.energyProxyMw / A.energyProxyMw))}% cooler by the energy proxy`
      : `B is ${r2(100 * (B.energyProxyMw / A.energyProxyMw - 1))}% HOTTER by the energy proxy`;
    console.log('[thermal] ' + verdict);
    return { a: a.label, b: b.label, rows, configChanged: changed, verdict };
  }

  function list() {
    const runs = loadRuns().map((r) => ({
      label: r.label, when: r.when, overall: r.overall,
      energyMw: r.metrics.energyProxyMw,
      cpuMsPerSec: r.metrics.cpu.totalMsPerSec,
      fps: r.metrics.presentedFps,
      mPixPerSec: r.metrics.gpu.totalMPixPerSec,
      cap: r.options.frameLimit, shadows: r.options.shadowQuality,
      ratio: r.display.appliedPixelRatio,
    }));
    console.table(runs);
    return runs;
  }

  function snapshot() {
    const config = readConfig();
    const projected = {
      mainMPixPerSec: r2((config.fill.mainPixPerFrame * (config.options.frameLimit || 60)) / 1e6),
      shadowMPixPerSec: r2((config.fill.shadowPixPerFrame * (config.options.frameLimit || 60)) / 1e6),
    };
    projected.totalMPixPerSec = r2(projected.mainMPixPerSec + projected.shadowMPixPerSec);
    projected.verdict = grade(projected.totalMPixPerSec, BUDGET.totalMPixPerSec);
    console.log('[thermal] static configuration (no measurement)');
    console.table([{
      backing: `${config.display.drawingBufferWidth}x${config.display.drawingBufferHeight}`,
      MPix: config.display.backingMPix,
      pixelRatio: config.display.appliedPixelRatio,
      fpsCap: config.options.frameLimit,
      shadowMap: config.fill.shadowMapSize,
      shadowAutoUpdate: config.fill.shadowAutoUpdate,
      simTps: config.options.simTicksPerSecTarget,
      textureMB: config.memory.totalMB,
    }]);
    console.table([projected]);
    return { config, projected };
  }

  function help() {
    console.log(`RA2 thermal probe v${VERSION}
  RA2Thermal.snapshot()                    static config + projected fill, no measurement
  await RA2Thermal.run({seconds:60, warmupSeconds:10, label:'A', scenario:'pan'|'static'})
  await RA2Thermal.runText({...})          same, returns a JSON string (for the shell REPL)
  await RA2Thermal.soak({minutes:10})      throttle detection over a long window
  await RA2Thermal.fillSweep()             fill-bound vs CPU-bound diagnosis (runs uncapped, ~25 s)
  await RA2Thermal.occupancy(10)           diagnostic only, inflates power
  RA2Thermal.compare('A','B')              A/B table + energy proxy delta
  RA2Thermal.compareText('A','B')
  RA2Thermal.list()                        saved runs (localStorage, survives relaunch)
  RA2Thermal.detach()                      emergency: undo all patches
  RA2Thermal.BUDGET                        the acceptance thresholds [green, amber]

Hold constant across A/B: same build, same device, airplane mode ON, brightness
fixed, Low Power Mode OFF, unplugged, same save game and tick range, same
scenario, same options string (compare() prints any drift it can see).`);
    return `RA2Thermal v${VERSION}`;
  }

  const jsonSafe = (value) => JSON.stringify(value, (k, v) => (k === 'buckets' ? undefined : v), 2);

  window.RA2Thermal = {
    version: VERSION,
    BUDGET, ENERGY,
    help, snapshot, run, soak, fillSweep, occupancy, compare, list,
    attach, detach,
    runText: async (opts) => jsonSafe(await run(opts)),
    soakText: async (opts) => jsonSafe(await soak(opts)),
    snapshotText: () => jsonSafe(snapshot()),
    fillSweepText: async (opts) => jsonSafe(await fillSweep(opts)),
    compareText: (a, b) => jsonSafe(compare(a, b)),
    listText: () => jsonSafe(list()),
    _state: S,
  };
  console.log(`[thermal v${VERSION}] ready — RA2Thermal.help()`);
})();
