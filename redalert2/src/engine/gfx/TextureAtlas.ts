import { IndexedBitmap } from '../../data/Bitmap';
import * as THREE from 'three';
import { GrowingPacker } from './GrowingPacker';
// Gutter around each packed image, filled with copies of its edge pixels.
// Without it, nearest-neighbor sampling at fractional zoom/pan reads texels
// from the adjacent atlas entry (visible as dots along tile edges, e.g. in
// the shroud). Rects still reference the unpadded image area, so UVs are
// unchanged.
const ATLAS_PADDING = 1;
function extrudeEdges(atlas: IndexedBitmap, x: number, y: number, w: number, h: number): void {
    const data = atlas.data;
    const stride = atlas.width;
    for (let p = 1; p <= ATLAS_PADDING; p++) {
        // top and bottom rows
        data.copyWithin((y - p) * stride + x, y * stride + x, y * stride + x + w);
        data.copyWithin((y + h - 1 + p) * stride + x, (y + h - 1) * stride + x, (y + h - 1) * stride + x + w);
        // left and right columns (including the just-written top/bottom pads)
        for (let row = y - p; row < y + h + p; row++) {
            data[row * stride + x - p] = data[row * stride + x];
            data[row * stride + x + w - 1 + p] = data[row * stride + x + w - 1];
        }
    }
}
function createAtlasBitmap(blocks: any[], width: number, height: number, imageRects?: Map<IndexedBitmap, any>): IndexedBitmap {
    const atlasBitmap = new IndexedBitmap(width, height);
    blocks.forEach(block => {
        if (!block.fit) {
            throw new Error("Couldn't fit all images in a single texture");
        }
        const image = block.image;
        const x = block.fit.x + ATLAS_PADDING;
        const y = block.fit.y + ATLAS_PADDING;
        imageRects?.set(image, { x, y, width: image.width, height: image.height });
        atlasBitmap.drawIndexedImage(image, x, y);
        extrudeEdges(atlasBitmap, x, y, image.width, image.height);
    });
    return atlasBitmap;
}
function createAtlasRgbaData(bitmap: IndexedBitmap): Uint8Array {
    const rgbaData = new Uint8Array(bitmap.width * bitmap.height * 4);
    for (let i = 0; i < bitmap.data.length; i++) {
        const rgbaIndex = i * 4;
        const paletteIndex = bitmap.data[i];
        rgbaData[rgbaIndex] = 0;
        rgbaData[rgbaIndex + 1] = 0;
        rgbaData[rgbaIndex + 2] = 0;
        rgbaData[rgbaIndex + 3] = paletteIndex;
    }
    return rgbaData;
}
export class TextureAtlas {
    private texture?: THREE.DataTexture;
    private imageRects?: Map<IndexedBitmap, any>;
    private width: number = 0;
    private height: number = 0;
    getTexture(): THREE.DataTexture {
        if (!this.texture) {
            throw new Error('Texture atlas not initialized');
        }
        return this.texture;
    }
    getImageRect(image: IndexedBitmap): any {
        if (!this.imageRects) {
            throw new Error('Texture atlas not initialized');
        }
        const rect = this.imageRects.get(image);
        if (!rect) {
            throw new Error('Image not found in atlas');
        }
        return rect;
    }
    pack(images: IndexedBitmap[]): void {
        const blocks: any[] = [];
        images.forEach(image => {
            const paddedWidth = image.width + 2 * ATLAS_PADDING;
            const paddedHeight = image.height + 2 * ATLAS_PADDING;
            blocks.push({
                w: paddedWidth + (paddedWidth % 2),
                h: paddedHeight + (paddedHeight % 2),
                image: image
            });
        });
        blocks.sort((a, b) => (b.w - a.w) * 10000 + b.h - a.h);
        const packer = new GrowingPacker();
        packer.fit(blocks);
        const width = packer.root.w;
        const height = packer.root.h;
        const imageRects = new Map<IndexedBitmap, any>();
        const atlasBitmap = createAtlasBitmap(blocks, width, height, imageRects);
        const rgbaData = createAtlasRgbaData(atlasBitmap);
        const texture = new THREE.DataTexture(rgbaData, width, height, THREE.RGBAFormat);
        texture.needsUpdate = true;
        // Once the GPU upload happens, drop the JS-side pixel copy — three
        // never frees texture.image.data, which otherwise doubles every
        // atlas to 8 bytes/pixel in the heap that gets jetsam-killed first.
        texture.onUpdate = function (this: THREE.DataTexture) {
            (this.image as any).data = null;
            this.onUpdate = null as any;
        } as any;
        texture.flipY = true;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.NoColorSpace;
        this.width = width;
        this.height = height;
        this.imageRects = imageRects;
        this.texture = texture;
    }
    dispose(): void {
        this.texture?.dispose();
    }
}
