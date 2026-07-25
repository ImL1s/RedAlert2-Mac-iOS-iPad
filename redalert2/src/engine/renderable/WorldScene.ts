import { pointEquals } from '../../util/geometry';
import { RenderableContainer } from '../gfx/RenderableContainer';
import { Renderer } from '../gfx/Renderer';
import { CameraPan } from './CameraPan';
import { CameraZoom } from './CameraZoom';
import { LightingType } from '../type/LightingType';
import { Coords } from '../../game/Coords';
import { EventDispatcher } from '../../util/event';
import { ShadowQuality } from './entity/unit/ShadowQuality';
import { MeshBatchManager } from '../gfx/batch/MeshBatchManager';
import { BoxedVar } from '../../util/BoxedVar';
import { setMeshLineViewportResolution } from './fx/MeshLineResolution';
import * as THREE from 'three';
const AMBIENT_LIGHT_INTENSITY = 0.8;
const CAMERA_FAR = 16000;
const SHADOW_QUALITY_MAP = new Map([
    [ShadowQuality.High, 8],
    [ShadowQuality.Medium, 4],
    [ShadowQuality.Low, 2]
]);
// Offset from the shadow-casting light to its target. Constant, so the shadow
// camera's orientation never changes and its basis can be computed once.
const LIGHT_OFFSET = new THREE.Vector3(-87.012, 204.338, 195.409);
// World-space slack added around the visible rect so off-screen objects still
// cast into it. The light extrudes a caster horizontally by ~1.05x its height;
// 1600 leptons covers the tallest building plus its shadow skirt.
const SHADOW_CASTER_MARGIN = 1600;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const scratchVecA = new THREE.Vector3();
const scratchVecB = new THREE.Vector3();
const scratchMat = new THREE.Matrix4();
const shadowRight = new THREE.Vector3();
const shadowUp = new THREE.Vector3();
const shadowBack = new THREE.Vector3();
let shadowBasisReady = false;
export class WorldScene extends RenderableContainer {
    public scene: THREE.Scene;
    public camera: THREE.OrthographicCamera;
    public viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    public cameraPan: CameraPan;
    public cameraZoom: CameraZoom;
    public shadowQuality: BoxedVar<ShadowQuality>;
    private initialized: boolean = false;
    private ambientLight: THREE.AmbientLight;
    private directionalLight: THREE.DirectionalLight;
    private _onBeforeCameraUpdate = new EventDispatcher<WorldScene, number>();
    private _onCameraUpdate = new EventDispatcher<WorldScene, number>();
    private lastCameraPan?: {
        x: number;
        y: number;
    };
    private lastCameraZoom?: number;
    private meshBatchManager?: MeshBatchManager;
    private shadowQualityListener?: () => void;
    private lightFocusPoint?: {
        x: number;
        y: number;
    };
    get onBeforeCameraUpdate() {
        return this._onBeforeCameraUpdate.asEvent();
    }
    get onCameraUpdate() {
        return this._onCameraUpdate.asEvent();
    }
    static factory(viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, enableLighting: BoxedVar<boolean>, shadowQuality: BoxedVar<ShadowQuality>): WorldScene {
        let scene = new THREE.Scene();
        scene.matrixAutoUpdate = false;
        // update() calls scene.updateMatrixWorld() itself; without this flag
        // WebGLRenderer.render() re-traverses the whole graph a second time
        // every frame.
        scene.matrixWorldAutoUpdate = false;
        const camera = WorldScene.createCamera(viewport);
        const cameraPan = new CameraPan(enableLighting);
        const cameraZoom = new CameraZoom(enableLighting);
        return new WorldScene(scene, camera, viewport, cameraPan, cameraZoom, shadowQuality);
    }
    static getCameraParams(viewport: {
        width: number;
        height: number;
    }) {
        const alpha = Coords.ISO_CAMERA_ALPHA;
        const beta = Coords.ISO_CAMERA_BETA;
        const worldScale = Coords.ISO_WORLD_SCALE;
        return {
            alpha,
            beta,
            d: (viewport.height / 2) * Coords.COS_ISO_CAMERA_BETA * worldScale,
            aspect: viewport.width / viewport.height,
            far: CAMERA_FAR * worldScale
        };
    }
    static createCamera(viewport: {
        width: number;
        height: number;
    }): THREE.OrthographicCamera {
        const { alpha, beta, d, aspect, far } = this.getCameraParams(viewport);
        const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0, far);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = +beta;
        camera.rotation.x = -alpha;
        setMeshLineViewportResolution(camera, viewport.width, viewport.height);
        return camera;
    }
    constructor(scene: THREE.Scene, camera: THREE.OrthographicCamera, viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    }, cameraPan: CameraPan, cameraZoom: CameraZoom, shadowQuality: BoxedVar<ShadowQuality>) {
        super(scene);
        this.scene = scene;
        this.camera = camera;
        this.viewport = viewport;
        this.cameraPan = cameraPan;
        this.cameraZoom = cameraZoom;
        this.shadowQuality = shadowQuality;
        this.ambientLight = new THREE.AmbientLight(0xFFFFFF, AMBIENT_LIGHT_INTENSITY);
        this.directionalLight = new THREE.DirectionalLight(0xFFFFFF, 1);
        this._onBeforeCameraUpdate = new EventDispatcher<WorldScene, number>();
        this._onCameraUpdate = new EventDispatcher<WorldScene, number>();
    }
    updateViewport(viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): void {
        this.viewport = viewport;
        const { d, aspect } = WorldScene.getCameraParams(viewport);
        const camera = this.camera;
        camera.left = -d * aspect;
        camera.right = d * aspect;
        camera.top = d;
        camera.bottom = -d;
        setMeshLineViewportResolution(camera, viewport.width, viewport.height);
        camera.updateProjectionMatrix();
        this.updateShadowCamera();
    }
    updateCamera(pan: {
        x: number;
        y: number;
    }, zoom: number): void {
        const camera = this.camera;
        camera.updateMatrix();
        const elements = camera.matrix.elements;
        const translation = new THREE.Vector3();
        camera.position.set(0, 0, 0);
        camera.translateZ(CAMERA_FAR * Coords.ISO_WORLD_SCALE);
        // Pan is expressed in zoom-1 screen pixels (matching the pan limits from
        // MapPanningHelper), so the translation must not depend on camera.zoom.
        // Snap the applied pan to whole DEVICE pixels (pan * zoom = logical px,
        // x pixelRatio = device px): fractional camera positions (touch
        // centroids, zoomed pan deltas, clamped limits) otherwise cause tile
        // seams in the shroud while scrolling.
        const snap = zoom * Renderer.activePixelRatio;
        const panX = Math.round(pan.x * snap) / snap;
        const panY = Math.round(pan.y * snap) / snap;
        translation.set(elements[0], elements[1], elements[2]);
        translation.multiplyScalar((panX * (camera.right - camera.left)) / this.viewport.width);
        camera.position.add(translation);
        translation.set(elements[4], elements[5], elements[6]);
        translation.multiplyScalar((-panY * (camera.top - camera.bottom)) / this.viewport.height);
        camera.position.add(translation);
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(false);
    }
    create3DObject(): void {
        super.create3DObject();
        if (!this.initialized) {
            this.initialized = true;
            this.scene.position.x -= 0.1 * Coords.ISO_WORLD_SCALE;
            this.scene.position.z -= 0.1 * Coords.ISO_WORLD_SCALE;
            this.scene.updateMatrix();
            const axesHelper = new THREE.AxesHelper(Coords.LEPTONS_PER_TILE);
            this.scene.add(axesHelper);
            this.scene.add(this.ambientLight);
            const light = this.directionalLight;
            light.position.copy(LIGHT_OFFSET);
            if (this.lightFocusPoint) {
                light.position.x += this.lightFocusPoint.x;
                light.position.z += this.lightFocusPoint.y;
                light.target.position.set(this.lightFocusPoint.x, 0, this.lightFocusPoint.y);
                light.target.updateMatrixWorld(undefined);
            }
            this.updateShadowQuality(light, this.shadowQuality.value);
            this.updateShadowCamera();
            this.shadowQualityListener = () => this.updateShadowQuality(light, this.shadowQuality.value);
            this.shadowQuality.onChange.subscribe(this.shadowQualityListener);
            this.scene.add(light);
            this.scene.add(this.camera);
            this.meshBatchManager = new MeshBatchManager(this);
            this.add(this.meshBatchManager);
            (this.scene as any).autoUpdate = false;
        }
    }
    updateShadowQuality(light: THREE.DirectionalLight, quality: ShadowQuality): void {
        const enableShadows = quality !== ShadowQuality.Off;
        light.castShadow = enableShadows;
        if (enableShadows) {
            const worldScale = Coords.ISO_WORLD_SCALE;
            const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
            shadowCamera.near = -4000 * worldScale;
            shadowCamera.far = 3000 * worldScale;
            const shadowMapMultiplier = SHADOW_QUALITY_MAP.get(quality);
            if (!shadowMapMultiplier) {
                throw new Error(`Unsupported shadow quality "${quality}"`);
            }
            // An 8192x8192 depth target is ~537MB of GPU memory — on mobile
            // that single allocation lands at the first world frame and can
            // get the WKWebView content process killed.
            //
            // The touch clamp is 1024 rather than 2048 because updateShadowCamera()
            // now fits the ortho box to the visible rect instead of covering 233
            // tiles of map: texel density is several times higher than it was at
            // 2048 over the old box, at a quarter of the depth-target bandwidth.
            const isCoarsePointer = typeof window !== 'undefined'
                && window.matchMedia?.('(pointer: coarse)').matches;
            const mapSize = Math.min(1024 * shadowMapMultiplier, isCoarsePointer ? 1024 : 8192);
            if (light.shadow.mapSize.width !== mapSize) {
                // three only reallocates the depth target when shadow.map is
                // null, so an existing one has to be dropped explicitly.
                light.shadow.map?.dispose();
                (light.shadow as any).map = null;
            }
            light.shadow.mapSize.width = mapSize;
            light.shadow.mapSize.height = mapSize;
            this.updateShadowCamera();
        }
    }
    /**
     * Fits the shadow ortho box to what the camera can actually see and moves
     * the light with it. The box used to be a fixed 233x233 tiles centred on the
     * map, so a ~23-tile view got roughly 1% of the depth texels; fitting it
     * raises texel density by ~40x, which is what pays for the smaller map.
     *
     * The box origin is snapped to whole shadow texels along the shadow camera's
     * own axes. Without that, panning slides the texel grid under static geometry
     * and every shadow edge crawls.
     */
    private updateShadowCamera(): void {
        const light = this.directionalLight;
        if (!light.castShadow) {
            return;
        }
        const camera = this.camera;
        const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
        const zoom = camera.zoom || 1;
        const viewWidth = (camera.right - camera.left) / zoom;
        const viewHeight = (camera.top - camera.bottom) / zoom;
        // Diagonal, because the shadow box is not axis-aligned with the view.
        const half = Math.hypot(viewWidth, viewHeight) / 2 + SHADOW_CASTER_MARGIN;
        // Ground point at the centre of the view.
        const dir = camera.getWorldDirection(scratchVecA);
        const centre = scratchVecB.copy(camera.position);
        if (Math.abs(dir.y) > 1e-6) {
            centre.addScaledVector(dir, -camera.position.y / dir.y);
        }
        // Shadow camera basis: fixed, because LIGHT_OFFSET never changes.
        if (!shadowBasisReady) {
            scratchMat.lookAt(LIGHT_OFFSET, ORIGIN, UP);
            shadowRight.setFromMatrixColumn(scratchMat, 0);
            shadowUp.setFromMatrixColumn(scratchMat, 1);
            shadowBack.setFromMatrixColumn(scratchMat, 2);
            shadowBasisReady = true;
        }
        const texel = (2 * half) / light.shadow.mapSize.width;
        const u = Math.round(centre.dot(shadowRight) / texel) * texel;
        const v = Math.round(centre.dot(shadowUp) / texel) * texel;
        const w = centre.dot(shadowBack);
        const target = light.target.position
            .set(0, 0, 0)
            .addScaledVector(shadowRight, u)
            .addScaledVector(shadowUp, v)
            .addScaledVector(shadowBack, w);
        light.position.copy(target).add(LIGHT_OFFSET);
        light.updateMatrixWorld(true);
        light.target.updateMatrixWorld(true);
        if (shadowCamera.right !== half) {
            shadowCamera.right = half;
            shadowCamera.left = -half;
            shadowCamera.top = half;
            shadowCamera.bottom = -half;
            shadowCamera.updateProjectionMatrix();
        }
    }
    setLightFocusPoint(x: number, y: number): void {
        this.lightFocusPoint = { x, y };
    }
    applyLighting(lighting: {
        computeTint: (type: LightingType) => THREE.Vector3;
        getAmbientIntensity: () => number;
    }): void {
        const tint = lighting.computeTint(LightingType.Ambient);
        this.ambientLight.color.setRGB(tint.x, tint.y, tint.z);
        this.directionalLight.color.setRGB(tint.x, tint.y, tint.z);
        const ambientIntensity = lighting.getAmbientIntensity();
        this.ambientLight.intensity = ambientIntensity * AMBIENT_LIGHT_INTENSITY;
        this.directionalLight.intensity = ambientIntensity;
    }
    update(deltaTime: number, time?: number): void {
        super.update(deltaTime);
        this._onBeforeCameraUpdate.dispatch(this, deltaTime);
        const zoom = this.cameraZoom.getZoom();
        const pan = this.cameraPan.getPan();
        if (!pointEquals(pan, this.lastCameraPan) || this.lastCameraZoom !== zoom) {
            this.updateCamera(pan, zoom);
            this.lastCameraZoom = zoom;
            this.lastCameraPan = pan;
            this.updateShadowCamera();
        }
        this._onCameraUpdate.dispatch(this, deltaTime);
        this.scene.updateMatrixWorld(false);
        this.meshBatchManager?.updateMeshes();
    }
    dispose(): void {
        if (this.shadowQualityListener) {
            this.shadowQuality.onChange.unsubscribe(this.shadowQualityListener);
            this.shadowQualityListener = undefined;
        }
        (this.directionalLight.shadow.map as any)?.dispose();
        if (this.meshBatchManager) {
            this.meshBatchManager.dispose();
            this.remove(this.meshBatchManager);
            this.meshBatchManager = undefined;
        }
        this.scene.remove(this.ambientLight);
        this.scene.remove(this.directionalLight);
    }
}
