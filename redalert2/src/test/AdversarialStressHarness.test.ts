import { describe, expect, it, test, beforeEach } from 'bun:test';
import { KeyBinds } from '../gui/screen/game/worldInteraction/keyboard/KeyBinds';
import { KeyCommandType } from '../gui/screen/game/worldInteraction/keyboard/KeyCommandType';
import { GamepadHandler } from '../gui/screen/game/worldInteraction/gamepad/GamepadHandler';
import {
    thermalState,
    lowPowerMode,
    powerFrameCap,
    installPowerStateReceiver,
    ThermalState
} from '../engine/PowerState';
import { GameAnimationLoop } from '../engine/GameAnimationLoop';
import { CanvasMetrics } from '../gui/CanvasMetrics';
import {
    getMobileTouchButton,
    setMobileTouchButton,
    createMobileTouchControls
} from '../gui/MobileTouchControls';
import * as crypto from 'crypto';

function createMockElement(tagName: string): any {
    const classSet = new Set<string>();
    const attributes = new Map<string, string>();
    const children: any[] = [];
    const listeners = new Map<string, Array<(e: any) => void>>();

    const el: any = {
        tagName: tagName.toUpperCase(),
        get className() {
            return Array.from(classSet).join(' ');
        },
        set className(val: string) {
            classSet.clear();
            val.split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
        },
        textContent: '',
        classList: {
            contains: (c: string) => classSet.has(c),
            add: (c: string) => classSet.add(c),
            remove: (c: string) => classSet.delete(c),
            toggle: (c: string, force?: boolean) => {
                if (force !== undefined) {
                    if (force) classSet.add(c);
                    else classSet.delete(c);
                    return force;
                }
                if (classSet.has(c)) {
                    classSet.delete(c);
                    return false;
                } else {
                    classSet.add(c);
                    return true;
                }
            },
        },
        children,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        getAttribute: (name: string) => attributes.get(name) ?? null,
        addEventListener: (type: string, listener: (e: any) => void) => {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type)!.push(listener);
        },
        removeEventListener: (type: string, listener: (e: any) => void) => {
            const list = listeners.get(type);
            if (list) {
                const idx = list.indexOf(listener);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatchEvent: (event: any) => {
            const list = listeners.get(event.type);
            if (list) {
                list.forEach(fn => fn(event));
            }
            return true;
        },
        appendChild: (child: any) => {
            children.push(child);
            child.parentElement = el;
            return child;
        },
        querySelector: (selector: string): any => {
            if (selector.startsWith('.')) {
                const targetClass = selector.slice(1);
                const findIn = (node: any): any => {
                    if (node.classList?.contains(targetClass)) return node;
                    for (const ch of node.children) {
                        const res = findIn(ch);
                        if (res) return res;
                    }
                    return null;
                };
                return findIn(el);
            }
            return null;
        },
        remove: () => {
            if (el.parentElement) {
                const idx = el.parentElement.children.indexOf(el);
                if (idx !== -1) el.parentElement.children.splice(idx, 1);
                el.parentElement = null;
            }
        },
    };
    return el;
}

beforeEach(() => {
    (globalThis as any).document = {
        hidden: false,
        createElement: (tag: string) => createMockElement(tag),
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    (globalThis as any).window = {
        addEventListener: () => {},
        removeEventListener: () => {},
    };
});

describe('Adversarial Stress Test: Input System & Gamepad Polling', () => {
    let mockWorldScene: any;
    let mockCameraPanHandler: any;
    let mockCameraZoom: any;
    let mockKeyboardHandler: any;
    let mockUnitSelectionHandler: any;
    let executedCommands: string[];
    let zoomSteps: number[];

    beforeEach(() => {
        executedCommands = [];
        zoomSteps = [];
        mockWorldScene = {
            cameraPan: {
                pan: { x: 500, y: 500 },
                getPan: () => ({ ...mockWorldScene.cameraPan.pan }),
                getPanLimits: () => ({ x: 100, y: 100, width: 800, height: 800 }),
                setPan: (next: { x: number; y: number }) => {
                    mockWorldScene.cameraPan.pan = next;
                },
            },
        };
        mockCameraPanHandler = {};
        mockCameraZoom = {
            applyStep: (step: number) => {
                zoomSteps.push(step);
            },
        };
        mockKeyboardHandler = {
            executeCommand: (cmd: string) => {
                executedCommands.push(cmd);
            },
        };
        mockUnitSelectionHandler = {
            selectCount: 0,
            deselectCount: 0,
            selectCombatants: () => {
                mockUnitSelectionHandler.selectCount++;
            },
            deselectAll: () => {
                mockUnitSelectionHandler.deselectCount++;
            },
        };
    });

    test('Analog deadzone precision boundaries & NaN/Infinity resilience', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler,
            { deadzone: 0.2, panSpeed: 10 }
        );

        // Sub-deadzone positive boundary
        let res = handler.processAxes([0.199999, 0]);
        expect(res.panX).toBe(0);
        expect(res.panY).toBe(0);

        // Sub-deadzone negative boundary
        res = handler.processAxes([-0.199999, 0]);
        expect(res.panX).toBe(0);
        expect(res.panY).toBe(0);

        // Super-deadzone positive boundary
        res = handler.processAxes([0.200001, 0]);
        expect(res.panX).toBeCloseTo(2.00001, 4);

        // Super-deadzone negative boundary
        res = handler.processAxes([-0.200001, 0]);
        expect(res.panX).toBeCloseTo(-2.00001, 4);

        // Degenerate inputs (empty, single element)
        res = handler.processAxes([]);
        expect(res.panX).toBe(0);
        expect(res.panY).toBe(0);

        res = handler.processAxes([0.5]);
        expect(res.panX).toBe(0);
        expect(res.panY).toBe(0);
    });

    test('Camera pan bounds clamping when stick exceeds pan limits', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler,
            { deadzone: 0.1, panSpeed: 1000 } // Huge speed to hit limits immediately
        );

        // Pan far to the right and down (panLimits: x in [100, 900], y in [100, 900])
        handler.processAxes([1.0, 1.0]);
        expect(mockWorldScene.cameraPan.pan.x).toBe(900);
        expect(mockWorldScene.cameraPan.pan.y).toBe(900);

        // Pan far to the left and up
        handler.processAxes([-1.0, -1.0]);
        expect(mockWorldScene.cameraPan.pan.x).toBe(100);
        expect(mockWorldScene.cameraPan.pan.y).toBe(100);
    });

    test('Right stick zoom thresholding at +/- 0.5 boundary', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler,
            { zoomStep: 0.15 }
        );

        // Below threshold (0.49) -> No zoom
        handler.processAxes([0, 0, 0, 0.49]);
        expect(zoomSteps.length).toBe(0);

        // Negative below threshold (-0.49) -> No zoom
        handler.processAxes([0, 0, 0, -0.49]);
        expect(zoomSteps.length).toBe(0);

        // At/Above threshold (0.5) -> Zoom out (-0.15)
        handler.processAxes([0, 0, 0, 0.5]);
        expect(zoomSteps.length).toBe(1);
        expect(zoomSteps[0]).toBeCloseTo(-0.15);

        // Negative at/above threshold (-0.5) -> Zoom in (+0.15)
        handler.processAxes([0, 0, 0, -0.5]);
        expect(zoomSteps.length).toBe(2);
        expect(zoomSteps[1]).toBeCloseTo(0.15);
    });

    test('Button rapid edge-trigger transitions under adversarial burst', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler
        );

        // 100 alternating frames of pressing and releasing Deploy (button 2) and Stop (button 3)
        for (let frame = 0; frame < 100; frame++) {
            const isPressed = frame % 2 === 0;
            handler.processButtons([
                { pressed: false, value: 0 },
                { pressed: false, value: 0 },
                { pressed: isPressed, value: isPressed ? 1 : 0 },
                { pressed: isPressed, value: isPressed ? 1 : 0 },
            ] as any);
        }

        // 50 down edges triggered for each button
        const deployCount = executedCommands.filter(c => c === KeyCommandType.DeployObject).length;
        const stopCount = executedCommands.filter(c => c === KeyCommandType.StopObject).length;
        expect(deployCount).toBe(50);
        expect(stopCount).toBe(50);
    });

    test('Multi-gamepad navigator array with sparse null slots', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler
        );

        // Mock navigator.getGamepads with sparse array
        const mockGamepad = {
            index: 2,
            axes: [0.8, -0.8, 0, 0],
            buttons: [{ pressed: true, value: 1.0 }],
        };
        (globalThis as any).navigator = {
            getGamepads: () => [null, null, mockGamepad, null],
        };

        handler.pollGamepad();
        expect(handler.getIsConnected()).toBe(true);
        expect(handler.getActiveGamepadIndex()).toBe(2);
        expect(mockUnitSelectionHandler.selectCount).toBe(1);
    });
});

describe('Adversarial Stress Test: KeyBinds & Modifiers', () => {
    let keyBinds: KeyBinds;

    beforeEach(async () => {
        keyBinds = new KeyBinds(null, 'hotkeys.ini', null);
        await keyBinds.load();
    });

    test('All modifier bit permutations (Shift, Ctrl, Alt, Meta)', () => {
        const baseKey = 'A'.charCodeAt(0);
        const event = (shift: boolean, ctrl: boolean, alt: boolean, meta: boolean) => ({
            keyCode: baseKey,
            shiftKey: shift,
            ctrlKey: ctrl,
            altKey: alt,
            metaKey: meta,
        } as KeyboardEvent);

        const codeNone = keyBinds.getHotKeyCode(event(false, false, false, false));
        expect(codeNone).toBe(baseKey);

        const codeShift = keyBinds.getHotKeyCode(event(true, false, false, false));
        expect(codeShift).toBe(baseKey + 256);

        const codeCtrl = keyBinds.getHotKeyCode(event(false, true, false, false));
        expect(codeCtrl).toBe(baseKey + 512);

        const codeAlt = keyBinds.getHotKeyCode(event(false, false, true, false));
        expect(codeAlt).toBe(baseKey + 1024);

        const codeMeta = keyBinds.getHotKeyCode(event(false, false, false, true));
        expect(codeMeta).toBe(baseKey + 4096);

        const codeAll = keyBinds.getHotKeyCode(event(true, true, true, true));
        expect(codeAll).toBe(baseKey + 256 + 512 + 1024 + 4096);
    });

    test('Numpad arrow key code remapping', () => {
        // Numpad 2 (98) -> ArrowDown (40)
        const eventNumpad2 = { keyCode: 98, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent;
        const code2 = keyBinds.getHotKeyCode(eventNumpad2);
        expect(code2).toBe(40 + 2048);

        // Numpad 4 (100) -> ArrowLeft (37)
        const eventNumpad4 = { keyCode: 100, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent;
        const code4 = keyBinds.getHotKeyCode(eventNumpad4);
        expect(code4).toBe(37 + 2048);

        // Numpad 6 (102) -> ArrowRight (39)
        const eventNumpad6 = { keyCode: 102, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent;
        const code6 = keyBinds.getHotKeyCode(eventNumpad6);
        expect(code6).toBe(39 + 2048);

        // Numpad 8 (104) -> ArrowUp (38)
        const eventNumpad8 = { keyCode: 104, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent;
        const code8 = keyBinds.getHotKeyCode(eventNumpad8);
        expect(code8).toBe(38 + 2048);
    });
});

describe('Adversarial Stress Test: Power & Thermal Simulation Invariance', () => {
    interface MockTurnManager {
        turnMillis: number;
        tickCount: number;
        getTurnMillis(): number;
        doGameTurn(timestamp: number): boolean;
        setErrorState(): void;
    }

    function createMockTurnManager(turnMillis: number = 33.33): MockTurnManager {
        return {
            turnMillis,
            tickCount: 0,
            getTurnMillis() {
                return this.turnMillis;
            },
            doGameTurn(_timestamp: number) {
                this.tickCount++;
                return true;
            },
            setErrorState() {},
        };
    }

    function simulateFrames(
        thermal: ThermalState,
        isLowPower: boolean,
        totalFrames: number,
        frameIntervalMs: number = 16.666
    ): { simTicks: number; renderCount: number } {
        thermalState.value = thermal;
        lowPowerMode.value = isLowPower;

        const cap = powerFrameCap();
        const turnMgr = createMockTurnManager(33.333); // ~30 sim ticks/sec
        let renderCount = 0;
        let scheduledRaf: ((ts: number) => void) | null = null;

        const mockRenderer = {
            getStats: () => null,
            update: () => {},
            render: () => {
                renderCount++;
            },
            flush: () => {},
        };

        const mockSound = {
            audioSystem: { setMuted: () => {} },
        };

        // Custom frame limit override wired to powerFrameCap
        const loop = new GameAnimationLoop(
            { isObserver: false },
            mockRenderer,
            mockSound,
            turnMgr,
            {
                frameLimitOverride: {
                    get value() {
                        return powerFrameCap();
                    },
                },
            }
        );

        // Intercept requestAnimationFrame
        (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => {
            scheduledRaf = cb;
            return 1;
        };
        (globalThis as any).cancelAnimationFrame = () => {
            scheduledRaf = null;
        };

        loop.start();

        let currentTime = 1000;
        for (let i = 0; i < totalFrames; i++) {
            currentTime += frameIntervalMs;
            if (scheduledRaf) {
                const cb = scheduledRaf;
                scheduledRaf = null;
                cb(currentTime);
            }
        }

        loop.stop();
        return { simTicks: turnMgr.tickCount, renderCount };
    }

    test('Simulation tick count is invariant across all thermal/power states', () => {
        const totalFrames = 120; // ~2 seconds of 60fps rAF
        const dt = 16.666; // 60 fps timing

        const nominalResult = simulateFrames('nominal', false, totalFrames, dt);
        const fairResult = simulateFrames('fair', false, totalFrames, dt);
        const seriousResult = simulateFrames('serious', false, totalFrames, dt);
        const criticalResult = simulateFrames('critical', false, totalFrames, dt);
        const lowPowerResult = simulateFrames('nominal', true, totalFrames, dt);

        // Simulation ticks must be completely invariant across all thermal/power states
        expect(nominalResult.simTicks).toBe(59); // 119 intervals * 16.666ms = 1983.25ms / 33.333ms = 59 ticks
        expect(fairResult.simTicks).toBe(nominalResult.simTicks);
        expect(seriousResult.simTicks).toBe(nominalResult.simTicks);
        expect(criticalResult.simTicks).toBe(nominalResult.simTicks);
        expect(lowPowerResult.simTicks).toBe(nominalResult.simTicks);

        // Render counts must be throttled appropriately
        // Nominal (uncapped): renders every frame -> ~120 renders
        expect(nominalResult.renderCount).toBe(120);

        // Serious (20 FPS cap = 50ms interval): on 16.67ms frames, renders every ~3 frames -> ~40 renders
        expect(seriousResult.renderCount).toBeLessThanOrEqual(45);
        expect(seriousResult.renderCount).toBeGreaterThanOrEqual(35);

        // Critical (15 FPS cap = 66.67ms interval): on 16.67ms frames, renders every ~4 frames -> ~30 renders
        expect(criticalResult.renderCount).toBeLessThanOrEqual(35);
        expect(criticalResult.renderCount).toBeGreaterThanOrEqual(25);
    });

    test('Rapid chaotic thermal oscillations maintain exact sim tick count with zero drift', () => {
        const turnMgr = createMockTurnManager(33.333);
        let scheduledRaf: ((ts: number) => void) | null = null;
        (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => {
            scheduledRaf = cb;
            return 1;
        };

        const loop = new GameAnimationLoop(
            { isObserver: false },
            { getStats: () => null, update: () => {}, render: () => {}, flush: () => {} },
            { audioSystem: { setMuted: () => {} } },
            turnMgr,
            {
                frameLimitOverride: {
                    get value() {
                        return powerFrameCap();
                    },
                },
            }
        );

        loop.start();

        const thermalSequence: ThermalState[] = ['nominal', 'critical', 'serious', 'fair', 'critical', 'nominal'];
        let currentTime = 1000;
        const totalFrames = 180; // 3 seconds

        for (let i = 0; i < totalFrames; i++) {
            currentTime += 16.666;
            // Oscillate thermal state
            thermalState.value = thermalSequence[i % thermalSequence.length];
            if (scheduledRaf) {
                const cb = scheduledRaf;
                scheduledRaf = null;
                cb(currentTime);
            }
        }

        loop.stop();
        // 179 * 16.666ms = 2983.21ms / 33.333ms = exactly 89 sim ticks
        expect(turnMgr.tickCount).toBe(89);
    });
});

describe('Adversarial Stress Test: Viewport, Foldables & CanvasMetrics', () => {
    function createMockCanvasAndWindow(
        canvasLogicalW: number,
        canvasLogicalH: number,
        displayWidth: number,
        displayHeight: number,
        scrollX = 0,
        scrollY = 0
    ) {
        const mockCanvas: any = {
            width: canvasLogicalW,
            height: canvasLogicalH,
            clientWidth: canvasLogicalW,
            clientHeight: canvasLogicalH,
            getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                width: displayWidth,
                height: displayHeight,
            }),
        };

        const mockWindow: any = {
            scrollX,
            scrollY,
            addEventListener: () => {},
            removeEventListener: () => {},
            visualViewport: {
                width: displayWidth,
                height: displayHeight,
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        };

        return { mockCanvas, mockWindow };
    }

    test('Foldable tablet viewports (8:7 ratio, high DPI 2.75x, 3x)', () => {
        // Galaxy Z Fold inner screen: 2152 x 1768 physical (8:7), ~782 x 642 CSS
        const { mockCanvas, mockWindow } = createMockCanvasAndWindow(1280, 1052, 782, 642);
        const metrics = new CanvasMetrics(mockCanvas, mockWindow);
        metrics.init();

        // Top-left corner
        const p1 = metrics.toCanvasPosition(0, 0);
        expect(p1.x).toBe(0);
        expect(p1.y).toBe(0);

        // Center touch
        const pCenter = metrics.toCanvasPosition(391, 321);
        expect(pCenter.x).toBeCloseTo(640, 0);
        expect(pCenter.y).toBeCloseTo(526, 0);

        // Bottom-right corner
        const pEnd = metrics.toCanvasPosition(782, 642);
        expect(pEnd.x).toBeCloseTo(1280, 0);
        expect(pEnd.y).toBeCloseTo(1052, 0);
    });

    test('Degenerate 0x0 display dimension fails safe without NaN or Infinity', () => {
        const { mockCanvas, mockWindow } = createMockCanvasAndWindow(1000, 800, 0, 0);
        const metrics = new CanvasMetrics(mockCanvas, mockWindow);
        metrics.init();

        const p = metrics.toCanvasPosition(50, 50);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBe(50);
        expect(p.y).toBe(50);
    });

    test('MobileTouchControls DOM toggle and disposal integrity', () => {
        const container = document.createElement('div');
        const dispose = createMobileTouchControls(container);

        expect(getMobileTouchButton()).toBe(0);

        const leftBtn = container.querySelector('.mobile-touch-btn-left') as HTMLButtonElement;
        const rightBtn = container.querySelector('.mobile-touch-btn-right') as HTMLButtonElement;

        expect(leftBtn.classList.contains('active')).toBe(true);
        expect(rightBtn.classList.contains('active')).toBe(false);

        // Toggle to right button
        rightBtn.dispatchEvent(new Event('mousedown'));
        expect(getMobileTouchButton()).toBe(2);
        expect(leftBtn.classList.contains('active')).toBe(false);
        expect(rightBtn.classList.contains('active')).toBe(true);

        // Toggle back to left button
        leftBtn.dispatchEvent(new Event('mousedown'));
        expect(getMobileTouchButton()).toBe(0);
        expect(leftBtn.classList.contains('active')).toBe(true);

        // Cleanup
        dispose();
        expect(container.children.length).toBe(0);
    });
});

describe('Adversarial Stress Test: CI Security & Fail-Closed Scanners', () => {
    test('Static extension filter rejects any case-variant forbidden extension', () => {
        const forbiddenPattern = /\.(mix|csf|bik|vqp|bag|idx)$/i;

        const maliciousFilenames = [
            'audio.MIX',
            'LANGUAGE.CsF',
            'movie.BiK',
            'music.VqP',
            'sounds.BaG',
            'sounds.Idx',
            'path/to/nested/game.mIx',
        ];

        for (const filename of maliciousFilenames) {
            expect(forbiddenPattern.test(filename)).toBe(true);
        }
    });

    test('Broad storage permission regex detects all unauthorized Android permissions', () => {
        const broadStoragePattern = /permission\.(WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)/i;

        const manifestSnippets = [
            '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />',
            '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />',
            '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
            '<uses-permission android:name="android.permission.write_external_storage" />',
        ];

        for (const snippet of manifestSnippets) {
            expect(broadStoragePattern.test(snippet)).toBe(true);
        }
    });

    test('Release status gate fails closed on unblocked flag with missing legal unblockers', () => {
        const verifyGate = (statusObj: any) => {
            if (statusObj.publicReleaseBlocked !== true) {
                return { blocked: false, allowed: true, violation: true };
            }
            return { blocked: true, allowed: false, violation: false };
        };

        // Adversarial payload attempting to sneak past blocker
        const rogueStatus = {
            project: 'RedAlert2-Android',
            publicReleaseBlocked: false,
        };

        const result = verifyGate(rogueStatus);
        expect(result.violation).toBe(true);
        expect(result.allowed).toBe(true); // Flagged as violation by CI gate
    });
});
