import { KeyCommandType } from '../keyboard/KeyCommandType';

export interface GamepadMappingConfig {
    deadzone?: number;
    panSpeed?: number;
    zoomStep?: number;
}

export class GamepadHandler {
    private isConnected = false;
    private activeGamepadIndex: number | null = null;
    private deadzone: number;
    private panSpeed: number;
    private zoomStep: number;
    private prevButtonStates: boolean[] = [];
    private animationFrameId: number | null = null;
    private isEnabled = true;

    constructor(
        private readonly worldScene: any,
        private readonly cameraPanHandler: any,
        private readonly cameraZoom: any,
        private readonly keyboardHandler: any,
        private readonly unitSelectionHandler: any,
        config?: GamepadMappingConfig
    ) {
        this.deadzone = config?.deadzone ?? 0.18;
        this.panSpeed = config?.panSpeed ?? 12;
        this.zoomStep = config?.zoomStep ?? 0.1;
    }

    init(): void {
        if (typeof window === 'undefined') return;
        window.addEventListener('gamepadconnected', this.handleGamepadConnected);
        window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
        this.startPollLoop();
    }

    dispose(): void {
        if (typeof window === 'undefined') return;
        window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
        window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
    }

    private readonly handleGamepadConnected = (e: any): void => {
        this.isConnected = true;
        this.activeGamepadIndex = e.gamepad?.index ?? null;
    };

    private readonly handleGamepadDisconnected = (e: any): void => {
        if (this.activeGamepadIndex === e.gamepad?.index) {
            this.activeGamepadIndex = null;
            this.isConnected = false;
        }
    };

    private startPollLoop(): void {
        const poll = () => {
            this.pollGamepad();
            if (typeof requestAnimationFrame !== 'undefined') {
                this.animationFrameId = requestAnimationFrame(poll);
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            this.animationFrameId = requestAnimationFrame(poll);
        }
    }

    pollGamepad(): void {
        if (!this.isEnabled || typeof navigator === 'undefined' || !navigator.getGamepads) {
            return;
        }

        const gamepads = navigator.getGamepads();
        let gamepad: Gamepad | null = null;
        if (this.activeGamepadIndex !== null && gamepads[this.activeGamepadIndex]) {
            gamepad = gamepads[this.activeGamepadIndex];
        } else {
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i]) {
                    gamepad = gamepads[i];
                    this.activeGamepadIndex = i;
                    this.isConnected = true;
                    break;
                }
            }
        }

        if (!gamepad) return;

        this.processAxes(gamepad.axes);
        this.processButtons(gamepad.buttons);
    }

    processAxes(axes: readonly number[]): { panX: number; panY: number } {
        if (!axes || axes.length < 2) return { panX: 0, panY: 0 };

        let axisX = axes[0] ?? 0;
        let axisY = axes[1] ?? 0;

        // Apply deadzone
        if (Math.abs(axisX) < this.deadzone) axisX = 0;
        if (Math.abs(axisY) < this.deadzone) axisY = 0;

        const panX = axisX * this.panSpeed;
        const panY = axisY * this.panSpeed;

        if (panX !== 0 || panY !== 0) {
            const currentPan = this.worldScene?.cameraPan?.getPan?.();
            if (currentPan) {
                const panLimits = this.worldScene.cameraPan.getPanLimits?.();
                let nextX = currentPan.x + panX;
                let nextY = currentPan.y + panY;
                if (panLimits) {
                    nextX = Math.max(panLimits.x, Math.min(panLimits.x + panLimits.width, nextX));
                    nextY = Math.max(panLimits.y, Math.min(panLimits.y + panLimits.height, nextY));
                }
                this.worldScene.cameraPan.setPan({ x: nextX, y: nextY });
            }
        }

        // Secondary stick (axes 2, 3) for zoom
        if (axes.length >= 4) {
            const rightY = axes[3] ?? 0;
            if (Math.abs(rightY) >= 0.5) {
                this.cameraZoom?.applyStep?.(rightY > 0 ? -this.zoomStep : this.zoomStep);
            }
        }

        return { panX, panY };
    }

    processButtons(buttons: readonly (GamepadButton | number)[]): void {
        if (!buttons) return;

        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const isPressed = typeof btn === 'object' && btn !== null ? btn.pressed : Number(btn) > 0.5;
            const wasPressed = this.prevButtonStates[i] || false;

            if (isPressed && !wasPressed) {
                this.onButtonDown(i);
            } else if (!isPressed && wasPressed) {
                this.onButtonUp(i);
            }

            this.prevButtonStates[i] = isPressed;
        }
    }

    onButtonDown(buttonIndex: number): void {
        switch (buttonIndex) {
            case 0: // A / Cross -> Select combatants
                this.unitSelectionHandler?.selectCombatants?.();
                break;
            case 1: // B / Circle -> Deselect all / Cancel
                this.unitSelectionHandler?.deselectAll?.();
                break;
            case 2: // X / Square -> Deploy object (D)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.DeployObject);
                break;
            case 3: // Y / Triangle -> Stop object (S)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.StopObject);
                break;
            case 4: // LB -> Zoom out
                this.cameraZoom?.applyStep?.(-this.zoomStep);
                break;
            case 5: // RB -> Zoom in
                this.cameraZoom?.applyStep?.(this.zoomStep);
                break;
            case 8: // Select / Back -> Center Base (H)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.CenterBase);
                break;
            case 9: // Start -> Options
                this.keyboardHandler?.executeCommand?.(KeyCommandType.Options);
                break;
            case 12: // D-Pad Up -> Scatter units (X)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.ScatterObject);
                break;
            case 13: // D-Pad Down -> Guard (G)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.GuardObject);
                break;
            case 14: // D-Pad Left -> Prev unit (M)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.PreviousObject);
                break;
            case 15: // D-Pad Right -> Next unit / Radar event (Space)
                this.keyboardHandler?.executeCommand?.(KeyCommandType.CenterOnRadarEvent);
                break;
        }
    }

    onButtonUp(_buttonIndex: number): void {
        // Reserved for held actions if needed
    }

    getActiveGamepadIndex(): number | null {
        return this.activeGamepadIndex;
    }

    getIsConnected(): boolean {
        return this.isConnected;
    }
}
