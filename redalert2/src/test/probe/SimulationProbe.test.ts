import { describe, expect, test } from 'bun:test';
import { GameTurnManager } from '@/game/GameTurnManager';
import { ActionQueue } from '@/game/action/ActionQueue';
import { NoAction } from '@/game/action/NoAction';
import { Action } from '@/game/action/Action';
import { ActionType } from '@/game/action/ActionType';
import { GameSpeed } from '@/game/GameSpeed';
import { IsoCoords } from '@/engine/IsoCoords';
import { Coords } from '@/game/Coords';
import { MapTileIntersectHelper } from '@/engine/util/MapTileIntersectHelper';
import { WorldViewportHelper } from '@/engine/util/WorldViewportHelper';

class TestProbeAction extends Action {
    public processedTicks: number[] = [];
    constructor(private readonly currentTickRef: () => number) {
        super(ActionType.DebugCommand);
    }
    unserialize(_data: Uint8Array): void {}
    serialize(): Uint8Array { return new Uint8Array(); }
    process(): void {
        this.processedTicks.push(this.currentTickRef());
    }
}

describe('Engine Simulation Probe', () => {
    test('GameTurnManager executes target ticks with action dispatching and rate changes', () => {
        const targetTicks = parseInt(process.env.PROBE_TICKS || '100', 10);
        let gameUpdateCount = 0;
        let actionsSentEvents = 0;

        const actionQueue = new ActionQueue();
        const mockGame = {
            update: () => {
                gameUpdateCount++;
            }
        };

        const turnManager = new GameTurnManager(mockGame, actionQueue);
        turnManager.init();
        turnManager.onActionsSent.subscribe(() => {
            actionsSentEvents++;
        });

        // Set standard 30 FPS rate
        turnManager.setRate(30);
        expect(turnManager.getTurnMillis()).toBe(33);

        const startTime = Date.now();
        let simTimestamp = 1000;

        for (let tick = 1; tick <= targetTicks; tick++) {
            if (tick % 10 === 0) {
                const action = new TestProbeAction(() => tick);
                actionQueue.push(action);
            } else if (tick % 25 === 0) {
                actionQueue.push(new NoAction());
            }

            const success = turnManager.doGameTurn(simTimestamp);
            expect(success).toBe(true);
            simTimestamp += turnManager.getTurnMillis();
        }

        const elapsedMs = Date.now() - startTime;
        expect(gameUpdateCount).toBe(targetTicks);
        expect(actionsSentEvents).toBeGreaterThanOrEqual(Math.floor(targetTicks / 10));
        expect(turnManager.getErrorState()).toBe(false);

        console.log(`[PROBE] GameTurnManager executed ${gameUpdateCount}/${targetTicks} ticks in ${elapsedMs}ms (${(elapsedMs / targetTicks).toFixed(3)}ms/tick).`);
    });

    test('GameSpeed calculations match discrete frame steps', () => {
        expect(GameSpeed.computeGameSpeed(6)).toBe(60 / 15);
        expect(GameSpeed.computeGameSpeed(5)).toBe(45 / 15);
        expect(GameSpeed.computeGameSpeed(3)).toBe((60 / 3) / 15);
        expect(GameSpeed.computeGameSpeed(1)).toBe((60 / 5) / 15);
    });

    test('Performance helpers and Viewport projection stability across simulation steps', () => {
        IsoCoords.init({ x: 0, y: 0 });
        const viewport = { x: 0, y: 0, width: 800, height: 600 };
        const pan = { x: 0, y: 0 };

        const tileHelper = new MapTileIntersectHelper({
            tiles: {
                getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y, z: 0 }),
            },
        } as any, {
            viewport,
            cameraPan: { getPan: () => pan },
        } as any);

        const viewportHelper = new WorldViewportHelper({
            viewport,
            cameraPan: { getPan: () => pan },
        } as any);

        for (let i = -20; i <= 20; i += 5) {
            const worldPos = { x: i * 128, y: Coords.tileHeightToWorld(0), z: i * 128 };
            const dist = viewportHelper.distanceToViewport(worldPos);
            expect(typeof dist).toBe('number');
            expect(dist).toBeGreaterThanOrEqual(0);
        }
    });

    test('Coordinate conversions and 3D height projections are deterministic', () => {
        IsoCoords.init({ x: 0, y: 0 });
        for (let x = -20; x <= 20; x += 5) {
            for (let y = -20; y <= 20; y += 5) {
                const world = Coords.tileToWorld(x, y);
                expect(world.x).toBe(x * Coords.LEPTONS_PER_TILE);
                expect(world.y).toBe(y * Coords.LEPTONS_PER_TILE);

                const v3 = Coords.tile3dToWorld(x, y, 2);
                expect(v3.x).toBe(world.x);
                expect(v3.z).toBe(world.y);
                expect(v3.y).toBe(Coords.tileHeightToWorld(2));

                const screen = IsoCoords.tileToScreen(x, y);
                expect(typeof screen.x).toBe('number');
                expect(typeof screen.y).toBe('number');

                const roundTripWorld = IsoCoords.screenToWorld(screen.x, screen.y);
                expect(roundTripWorld.x).toBeCloseTo(world.x, 0);
                expect(roundTripWorld.y).toBeCloseTo(world.y, 0);
            }
        }
    });
});
