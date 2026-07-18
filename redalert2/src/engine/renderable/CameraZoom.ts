import { BoxedVar } from '../../util/BoxedVar';
import { EventDispatcher } from '../../util/event';

export class CameraZoom {
    static readonly MAX_ZOOM = 2;
    private freeCamera: BoxedVar<boolean>;
    private zoom: number;
    // Lower bound so zooming out never reveals space beyond the map edges.
    // Owners of the map/viewport (WorldView) keep this up to date.
    private minZoom: number;
    private readonly _onChange = new EventDispatcher<CameraZoom, number>();
    get onChange() {
        return this._onChange.asEvent();
    }
    constructor(freeCamera: BoxedVar<boolean>) {
        this.freeCamera = freeCamera;
        this.zoom = 1;
        this.minZoom = 1;
    }
    getZoom(): number {
        return this.zoom;
    }
    setMinZoom(minZoom: number): void {
        this.minZoom = Math.min(1, Math.max(0.1, minZoom));
        if (this.zoom < this.minZoom) {
            this.setZoom(this.minZoom);
        }
    }
    setZoom(zoom: number): void {
        const next = this.freeCamera.value
            ? Math.max(0.1, zoom)
            : Math.min(CameraZoom.MAX_ZOOM, Math.max(this.minZoom, zoom));
        if (next !== this.zoom) {
            this.zoom = next;
            this._onChange.dispatch(this, next);
        }
    }
    applyStep(step: number): void {
        this.setZoom(this.zoom + step);
    }
    reset(): void {
        this.minZoom = 1;
        this.setZoom(1);
    }
}
