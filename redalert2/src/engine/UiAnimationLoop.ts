import { Renderer } from './gfx/Renderer';
import { recordUiPerformanceFrame } from '@/performance/PerformanceRuntime';
// Menus and static screens gain nothing from display-rate rendering; capping
// them keeps idle power (and device heat) down.
const MENU_FPS = 30;
const MENU_FRAME_SLACK_MS = 4;
export class UiAnimationLoop {
    private renderer: Renderer;
    private isStarted: boolean = false;
    private paused: boolean = false;
    private rafId?: number;
    private backgroundIntervalId?: number;
    private lastRenderTime: number = 0;
    constructor(renderer: Renderer) {
        this.renderer = renderer;
    }
    private doBackgroundFrame = (timestamp: number): void => {
        if (this.isStarted && this.paused) {
            this.renderer.update(timestamp);
        }
    };
    private doFrame = (timestamp: number): void => {
        if (this.isStarted && !this.paused) {
            if (timestamp - this.lastRenderTime < 1000 / MENU_FPS - MENU_FRAME_SLACK_MS) {
                this.rafId = requestAnimationFrame(this.doFrame);
                return;
            }
            this.lastRenderTime = timestamp;
            recordUiPerformanceFrame(timestamp);
            const stats = this.renderer.getStats();
            if (stats) {
                stats.begin();
            }
            this.renderer.update(timestamp);
            this.renderer.render();
            if (stats) {
                stats.end();
            }
            this.rafId = requestAnimationFrame(this.doFrame);
        }
    };
    private handleVisibilityChange = (): void => {
        const isHidden = document.hidden;
        if (this.paused !== isHidden) {
            this.paused = isHidden;
            if (this.paused) {
                if (this.rafId) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = undefined;
                }
                this.backgroundIntervalId = setInterval(() => {
                    const timestamp = performance.now();
                    this.doBackgroundFrame(timestamp);
                }, 1000);
            }
            else {
                if (this.backgroundIntervalId) {
                    clearInterval(this.backgroundIntervalId);
                    this.backgroundIntervalId = undefined;
                }
                this.rafId = requestAnimationFrame(this.doFrame);
            }
        }
    };
    start(): void {
        if (!this.isStarted) {
            this.isStarted = true;
            this.paused = false;
            if (document.hidden) {
                this.handleVisibilityChange();
            }
            else {
                this.rafId = requestAnimationFrame(this.doFrame);
            }
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }
    stop(): void {
        if (this.isStarted) {
            this.isStarted = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
            if (this.backgroundIntervalId) {
                clearInterval(this.backgroundIntervalId);
                this.backgroundIntervalId = undefined;
            }
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }
    destroy(): void {
        this.stop();
        this.renderer.flush();
    }
}
