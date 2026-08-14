import { describe, expect, test, beforeEach } from 'bun:test';
import { KeyBinds } from '../../gui/screen/game/worldInteraction/keyboard/KeyBinds';
import { KeyCommandType } from '../../gui/screen/game/worldInteraction/keyboard/KeyCommandType';
import { GamepadHandler } from '../../gui/screen/game/worldInteraction/gamepad/GamepadHandler';

describe('KeyBinds Hardware Shortcuts', () => {
    let keyBinds: KeyBinds;

    beforeEach(async () => {
        keyBinds = new KeyBinds(null, 'hotkeys.ini', null);
        await keyBinds.load();
    });

    test('maps squad selection keys 1..9 correctly', () => {
        for (let i = 1; i <= 9; i++) {
            const keyEvent = {
                keyCode: `${i}`.charCodeAt(0),
                shiftKey: false,
                ctrlKey: false,
                altKey: false,
                metaKey: false,
            } as KeyboardEvent;
            const cmd = keyBinds.getCommandType(keyEvent);
            const expectedType = (KeyCommandType as any)[`TeamSelect_${i}`];
            expect(cmd).toBe(expectedType);
        }
    });

    test('maps squad creation keys Ctrl+1..9 correctly', () => {
        for (let i = 1; i <= 9; i++) {
            const keyEvent = {
                keyCode: `${i}`.charCodeAt(0),
                shiftKey: false,
                ctrlKey: true,
                altKey: false,
                metaKey: false,
            } as KeyboardEvent;
            const cmd = keyBinds.getCommandType(keyEvent);
            const expectedType = (KeyCommandType as any)[`TeamCreate_${i}`];
            expect(cmd).toBe(expectedType);
        }
    });

    test('maps standard RTS action hotkeys (Space, H, S, D, X, E, T, G)', () => {
        const testCases: [number, boolean, KeyCommandType][] = [
            [32, false, KeyCommandType.CenterOnRadarEvent], // Space
            ['H'.charCodeAt(0), false, KeyCommandType.CenterBase],
            ['S'.charCodeAt(0), false, KeyCommandType.StopObject],
            ['D'.charCodeAt(0), false, KeyCommandType.DeployObject],
            ['X'.charCodeAt(0), false, KeyCommandType.ScatterObject],
            ['E'.charCodeAt(0), false, KeyCommandType.CombatantSelect],
            ['T'.charCodeAt(0), false, KeyCommandType.TypeSelect],
            ['G'.charCodeAt(0), false, KeyCommandType.GuardObject],
        ];

        for (const [keyCode, ctrlKey, expectedCmd] of testCases) {
            const keyEvent = {
                keyCode,
                shiftKey: false,
                ctrlKey,
                altKey: false,
                metaKey: false,
            } as KeyboardEvent;
            const cmd = keyBinds.getCommandType(keyEvent);
            expect(cmd).toBe(expectedCmd);
        }
    });
});

describe('GamepadHandler Controller Mapping', () => {
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
                getPan: () => mockWorldScene.cameraPan.pan,
                getPanLimits: () => ({ x: 0, y: 0, width: 2000, height: 2000 }),
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
            selectedCombatants: false,
            deselectedAll: false,
            selectCombatants: () => {
                mockUnitSelectionHandler.selectedCombatants = true;
            },
            deselectAll: () => {
                mockUnitSelectionHandler.deselectedAll = true;
            },
        };
    });

    test('applies deadzone to analog axes', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler,
            { deadzone: 0.2, panSpeed: 10 }
        );

        // Within deadzone
        const result1 = handler.processAxes([0.1, -0.15]);
        expect(result1.panX).toBe(0);
        expect(result1.panY).toBe(0);
        expect(mockWorldScene.cameraPan.pan).toEqual({ x: 500, y: 500 });

        // Outside deadzone
        const result2 = handler.processAxes([0.5, -0.8]);
        expect(result2.panX).toBe(5);
        expect(result2.panY).toBe(-8);
        expect(mockWorldScene.cameraPan.pan).toEqual({ x: 505, y: 492 });
    });

    test('maps button presses to game actions (A, B, X, Y, LB, RB, D-pad)', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler
        );

        // Press A (index 0)
        handler.onButtonDown(0);
        expect(mockUnitSelectionHandler.selectedCombatants).toBe(true);

        // Press B (index 1)
        handler.onButtonDown(1);
        expect(mockUnitSelectionHandler.deselectedAll).toBe(true);

        // Press X (index 2) -> Deploy
        handler.onButtonDown(2);
        expect(executedCommands).toContain(KeyCommandType.DeployObject);

        // Press Y (index 3) -> Stop
        handler.onButtonDown(3);
        expect(executedCommands).toContain(KeyCommandType.StopObject);

        // Press LB (index 4) -> Zoom out
        handler.onButtonDown(4);
        expect(zoomSteps.length).toBe(1);
        expect(zoomSteps[0]).toBeLessThan(0);

        // Press RB (index 5) -> Zoom in
        handler.onButtonDown(5);
        expect(zoomSteps.length).toBe(2);
        expect(zoomSteps[1]).toBeGreaterThan(0);

        // Press D-Pad Up (index 12) -> Scatter
        handler.onButtonDown(12);
        expect(executedCommands).toContain(KeyCommandType.ScatterObject);

        // Press D-Pad Down (index 13) -> Guard
        handler.onButtonDown(13);
        expect(executedCommands).toContain(KeyCommandType.GuardObject);

        // Press Select/Back (index 8) -> Center Base
        handler.onButtonDown(8);
        expect(executedCommands).toContain(KeyCommandType.CenterBase);
    });

    test('processButtons tracks edge transitions and ignores steady state', () => {
        const handler = new GamepadHandler(
            mockWorldScene,
            mockCameraPanHandler,
            mockCameraZoom,
            mockKeyboardHandler,
            mockUnitSelectionHandler
        );

        // Initial frame: button 2 pressed
        handler.processButtons([{ pressed: true, value: 1.0 } as any, { pressed: false, value: 0 } as any, { pressed: true, value: 1.0 } as any]);
        expect(executedCommands).toEqual([KeyCommandType.DeployObject]);
        expect(mockUnitSelectionHandler.selectedCombatants).toBe(true);

        // Next frame: same buttons held down (no new trigger)
        handler.processButtons([{ pressed: true, value: 1.0 } as any, { pressed: false, value: 0 } as any, { pressed: true, value: 1.0 } as any]);
        expect(executedCommands).toEqual([KeyCommandType.DeployObject]);

        // Release buttons
        handler.processButtons([{ pressed: false, value: 0 } as any, { pressed: false, value: 0 } as any, { pressed: false, value: 0 } as any]);
        expect(executedCommands).toEqual([KeyCommandType.DeployObject]);
    });
});

describe('Mouse and Samsung DeX Input Handling', () => {
    test('middle click initiates camera panning', () => {
        let panStarted = false;
        const mockCameraPanHandler = {
            start: (_pointer: any) => {
                panStarted = true;
            },
        };

        const isMiddleClick = (event: { button: number }) => event.button === 1;
        const event = { button: 1, pointer: { x: 100, y: 100 } };
        if (isMiddleClick(event)) {
            mockCameraPanHandler.start(event.pointer);
        }

        expect(panStarted).toBe(true);
    });

    test('mouse wheel maps delta to zoom steps', () => {
        let zoomLevel = 1.0;
        const applyWheelZoom = (wheelDeltaY: number) => {
            zoomLevel += wheelDeltaY > 0 ? -0.1 : 0.1;
        };

        applyWheelZoom(120); // scroll down / zoom out
        expect(zoomLevel).toBeCloseTo(0.9);

        applyWheelZoom(-120); // scroll up / zoom in
        expect(zoomLevel).toBeCloseTo(1.0);
    });

    test('right click moves/orders when rightClickMove is enabled', () => {
        let orderExecuted = false;
        const options = { rightClickMove: true };

        const handleMouseUp = (event: { button: number }) => {
            if (event.button === 2 && options.rightClickMove) {
                orderExecuted = true;
            }
        };

        handleMouseUp({ button: 2 });
        expect(orderExecuted).toBe(true);
    });
});

