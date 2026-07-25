import * as THREE from 'three';
import { BatchedMesh, BatchMode } from './BatchedMesh';
import { MeshInstancingBatch } from './MeshInstancingBatch';
import { RenderableContainer } from '../RenderableContainer';
import { MeshMergingBatch } from './MeshMergingBatch';
interface MeshBatch {
    castShadow: boolean;
    receiveShadow: boolean;
    renderOrder: number;
    clippingPlanes: THREE.Plane[];
    setMeshes(meshes: BatchedMesh[]): void;
    dispose(): void;
}
export class MeshBatchManager extends RenderableContainer {
    private renderableContainer: RenderableContainer;
    private batches: Map<string, MeshBatch[]> = new Map();
    // updateMeshes() runs EVERY rendered frame. Measured on an iPad mini it
    // cost 42 ms/s of a ~500 ms/s total CPU budget, almost none of it useful:
    // it allocated a fresh mesh array and group map per frame and rebuilt a
    // string batch key (two 36-char UUIDs each) for every batched mesh. These
    // pooled containers and the cached keys below remove the allocation and
    // the string building without changing a single batching decision.
    private scratchMeshes: BatchedMesh[] = [];
    private scratchGroups: Map<string, BatchedMesh[]> = new Map();
    constructor(renderableContainer: RenderableContainer) {
        super();
        this.renderableContainer = renderableContainer;
    }
    create3DObject(): void {
        let container = this.get3DObject();
        if (!container) {
            container = new THREE.Object3D();
            container.name = "mesh_batch_manager";
            container.matrixAutoUpdate = false;
            this.set3DObject(container);
        }
        super.create3DObject();
    }
    updateMeshes(): void {
        const container = this.renderableContainer.get3DObject();
        if (!container)
            return;
        const meshes = this.collectMeshes(container);
        const groupedMeshes = this.groupMeshesByBatchKey(meshes);
        const usedBatchCounts = this.fillBatches(groupedMeshes);
        this.cleanUnusedBatches(usedBatchCounts);
    }
    private collectMeshes(container: THREE.Object3D): BatchedMesh[] {
        const meshes = this.scratchMeshes;
        meshes.length = 0;
        container.traverseVisible((object) => {
            if ((object as any).isBatchedMesh) {
                meshes.push(object as BatchedMesh);
            }
        });
        return meshes;
    }
    private fillBatches(groupedMeshes: Map<string, BatchedMesh[]>): Map<string, number> {
        const usedBatchCounts = new Map<string, number>([...this.batches.keys()].map(key => [key, 0]));
        for (const [batchKey, meshes] of groupedMeshes) {
            if (meshes.length === 0) {
                continue;
            }
            let batchArray = this.batches.get(batchKey);
            let batchIndex = 0;
            while (meshes.length > 0) {
                const isInstancing = meshes[0].batchMode === BatchMode.Instancing;
                const maxInstances = isInstancing ? 1024 : 128;
                const batchMeshes = meshes.splice(0, maxInstances);
                let batch = batchArray?.[batchIndex];
                if (!batch) {
                    if (!batchArray) {
                        batchArray = [];
                        this.batches.set(batchKey, batchArray);
                    }
                    batch = new (isInstancing ? MeshInstancingBatch : MeshMergingBatch)(maxInstances);
                    batch.castShadow = batchMeshes[0].castShadow;
                    batch.receiveShadow = batchMeshes[0].receiveShadow;
                    batch.renderOrder = batchMeshes[0].renderOrder;
                    batch.clippingPlanes = batchMeshes[0].getClippingPlanes();
                    batchArray.push(batch);
                    this.add(batch as any);
                    this.processRenderQueue();
                }
                batch.setMeshes(batchMeshes);
                batchIndex++;
            }
            usedBatchCounts.set(batchKey, batchIndex);
        }
        return usedBatchCounts;
    }
    private cleanUnusedBatches(usedBatchCounts: Map<string, number>): void {
        for (const [batchKey, usedCount] of usedBatchCounts) {
            const batchArray = this.batches.get(batchKey);
            if (batchArray) {
                const unusedBatches = batchArray.splice(usedCount);
                for (const batch of unusedBatches) {
                    this.remove(batch as any);
                    batch.dispose();
                }
                if (batchArray.length === 0) {
                    this.batches.delete(batchKey);
                }
            }
        }
    }
    private groupMeshesByBatchKey(meshes: BatchedMesh[]): Map<string, BatchedMesh[]> {
        const groups = this.scratchGroups;
        // Empty a reused group instead of dropping it: fillBatches skips empty
        // groups, and usedBatchCounts is pre-seeded to 0 for every existing
        // batch key, so cleanup behaves exactly as it did with a fresh map.
        for (const group of groups.values()) {
            group.length = 0;
        }
        for (let i = 0, length = meshes.length; i < length; i++) {
            const mesh = meshes[i];
            const batchKey = this.getBatchKey(mesh);
            let group = groups.get(batchKey);
            if (!group) {
                group = [];
                groups.set(batchKey, group);
            }
            group.push(mesh);
        }
        return groups;
    }
    private getBatchKey(mesh: BatchedMesh): string {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const geometryPart = mesh.batchMode === BatchMode.Instancing
            ? mesh.geometry.uuid
            : mesh.geometry.attributes.position.count;
        const clippingHash = mesh.getClippingPlanesHash();
        // Comparing seven scalars is far cheaper than concatenating them into
        // a ~90-character string (with two UUIDs) for every batched mesh on
        // every frame — and these inputs almost never change for a live mesh.
        const cached = (mesh as any).__batchKeyCache;
        if (cached !== undefined &&
            cached.mode === mesh.batchMode &&
            cached.geometry === geometryPart &&
            cached.material === material.uuid &&
            cached.castShadow === mesh.castShadow &&
            cached.renderOrder === mesh.renderOrder &&
            cached.receiveShadow === mesh.receiveShadow &&
            cached.clipping === clippingHash) {
            return cached.key;
        }
        const key = (mesh.batchMode +
            "_" +
            geometryPart +
            "_" +
            material.uuid +
            "_" +
            Number(mesh.castShadow) +
            "_" +
            mesh.renderOrder +
            "_" +
            Number(mesh.receiveShadow) +
            "_" +
            clippingHash);
        (mesh as any).__batchKeyCache = {
            mode: mesh.batchMode,
            geometry: geometryPart,
            material: material.uuid,
            castShadow: mesh.castShadow,
            renderOrder: mesh.renderOrder,
            receiveShadow: mesh.receiveShadow,
            clipping: clippingHash,
            key,
        };
        return key;
    }
    dispose(): void {
        this.batches.forEach(batchArray => batchArray.forEach(batch => batch.dispose()));
    }
}
