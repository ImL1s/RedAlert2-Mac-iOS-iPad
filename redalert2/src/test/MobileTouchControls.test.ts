import { describe, expect, test, beforeEach } from 'bun:test';
import {
    getMobileTouchButton,
    setMobileTouchButton,
    createMobileTouchControls
} from '../gui/MobileTouchControls';
import { CanvasMetrics } from '../gui/CanvasMetrics';

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

describe('MobileTouchControls & CanvasMetrics', () => {
    beforeEach(() => {
        setMobileTouchButton(0);
        (globalThis as any).document = {
            createElement: (tag: string) => createMockElement(tag),
        };
        (globalThis as any).window = {
            scrollX: 0,
            scrollY: 0,
            addEventListener: () => {},
            removeEventListener: () => {},
        };
    });

    describe('MobileTouchControls', () => {
        test('getter and setter manage active mobile touch button', () => {
            expect(getMobileTouchButton()).toBe(0);
            setMobileTouchButton(2);
            expect(getMobileTouchButton()).toBe(2);
            setMobileTouchButton(0);
            expect(getMobileTouchButton()).toBe(0);
        });

        test('createMobileTouchControls creates DOM buttons and toggles active state', () => {
            const container = (globalThis as any).document.createElement('div');
            const cleanup = createMobileTouchControls(container);

            const wrapper = container.querySelector('.mobile-touch-controls');
            expect(wrapper).not.toBeNull();

            const leftBtn = container.querySelector('.mobile-touch-btn-left');
            const rightBtn = container.querySelector('.mobile-touch-btn-right');

            expect(leftBtn).not.toBeNull();
            expect(rightBtn).not.toBeNull();
            expect(leftBtn.classList.contains('active')).toBe(true);
            expect(rightBtn.classList.contains('active')).toBe(false);

            // Trigger click on right button
            rightBtn.dispatchEvent({
                type: 'mousedown',
                preventDefault: () => {},
                stopPropagation: () => {},
            });
            expect(getMobileTouchButton()).toBe(2);
            expect(rightBtn.classList.contains('active')).toBe(true);
            expect(leftBtn.classList.contains('active')).toBe(false);

            // Trigger click on left button
            leftBtn.dispatchEvent({
                type: 'mousedown',
                preventDefault: () => {},
                stopPropagation: () => {},
            });
            expect(getMobileTouchButton()).toBe(0);
            expect(leftBtn.classList.contains('active')).toBe(true);
            expect(rightBtn.classList.contains('active')).toBe(false);

            cleanup();
            expect(container.querySelector('.mobile-touch-controls')).toBeNull();
        });
    });

    describe('CanvasMetrics position scaling', () => {
        test('toCanvasPosition preserves 1:1 scaling when width equals displayWidth', () => {
            const canvas: any = {
                width: 800,
                height: 600,
                clientWidth: 800,
                clientHeight: 600,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            };
            const metrics = new CanvasMetrics(canvas, (globalThis as any).window);
            metrics.width = 800;
            metrics.height = 600;
            metrics.displayWidth = 800;
            metrics.displayHeight = 600;
            metrics.x = 0;
            metrics.y = 0;

            const pos = metrics.toCanvasPosition(100, 150);
            expect(pos.x).toBe(100);
            expect(pos.y).toBe(150);
        });

        test('toCanvasPosition correctly scales coordinates when high DPI ratio is applied', () => {
            const canvas: any = {
                width: 1600,
                height: 1200,
                clientWidth: 400,
                clientHeight: 300,
                getBoundingClientRect: () => ({ left: 50, top: 50, width: 400, height: 300 }),
            };
            const metrics = new CanvasMetrics(canvas, (globalThis as any).window);
            metrics.width = 800;
            metrics.height = 600;
            metrics.displayWidth = 400;
            metrics.displayHeight = 300;
            metrics.x = 50;
            metrics.y = 50;

            const pos = metrics.toCanvasPosition(150, 200); // (150-50)*2 = 200, (200-50)*2 = 300
            expect(pos.x).toBe(200);
            expect(pos.y).toBe(300);
        });
    });
});
