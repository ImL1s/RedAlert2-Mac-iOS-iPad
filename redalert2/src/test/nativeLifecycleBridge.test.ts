import { describe, it, expect, beforeEach } from 'bun:test';
import {
    registerActiveGameScreen,
    registerActiveAudioSystem,
    registerBackNavigationHandler,
    registerAutosaveHandler,
    handleBackPressed,
    handleAudioFocusChange,
    handleLifecycleEvent,
    triggerAutosave,
    installNativeLifecycleListeners,
    type LifecycleGameScreenTarget,
    type LifecycleAudioSystemTarget
} from '../shell/nativeLifecycleBridge';

describe('nativeLifecycleBridge', () => {
    beforeEach(() => {
        registerActiveGameScreen(undefined);
        registerActiveAudioSystem(undefined);
        registerBackNavigationHandler(undefined);
        registerAutosaveHandler(undefined);
    });

    describe('Back Navigation', () => {
        it('returns false when no handler or game screen is registered', () => {
            expect(handleBackPressed()).toBe(false);
        });

        it('closes menu when menu is open', () => {
            let menuOpen = true;
            let closeCalled = false;
            let openCalled = false;

            const fakeScreen: LifecycleGameScreenTarget = {
                isMenuOpen: () => menuOpen,
                closeMenu: () => { closeCalled = true; menuOpen = false; },
                openMenu: () => { openCalled = true; menuOpen = true; }
            };

            registerActiveGameScreen(fakeScreen);
            const handled = handleBackPressed();

            expect(handled).toBe(true);
            expect(closeCalled).toBe(true);
            expect(openCalled).toBe(false);
        });

        it('opens menu when menu is closed', () => {
            let menuOpen = false;
            let closeCalled = false;
            let openCalled = false;

            const fakeScreen: LifecycleGameScreenTarget = {
                isMenuOpen: () => menuOpen,
                closeMenu: () => { closeCalled = true; menuOpen = false; },
                openMenu: () => { openCalled = true; menuOpen = true; }
            };

            registerActiveGameScreen(fakeScreen);
            const handled = handleBackPressed();

            expect(handled).toBe(true);
            expect(openCalled).toBe(true);
            expect(closeCalled).toBe(false);
        });

        it('delegates to custom BackNavigationHandler when registered', () => {
            let customCalled = false;
            registerBackNavigationHandler({
                handleBackPressed: () => {
                    customCalled = true;
                    return true;
                }
            });

            expect(handleBackPressed()).toBe(true);
            expect(customCalled).toBe(true);
        });
    });

    describe('Audio Focus', () => {
        it('scales volume to 0.2 on transient duck focus loss', () => {
            let volumeScale = 1.0;
            const fakeAudio: LifecycleAudioSystemTarget = {
                setMasterVolumeScale: (scale: number) => {
                    volumeScale = scale;
                }
            };

            registerActiveAudioSystem(fakeAudio);
            handleAudioFocusChange({ focused: false, duck: true });
            expect(volumeScale).toBe(0.2);
        });

        it('mutes volume (0.0) on non-ducking focus loss', () => {
            let volumeScale = 1.0;
            const fakeAudio: LifecycleAudioSystemTarget = {
                setMasterVolumeScale: (scale: number) => {
                    volumeScale = scale;
                }
            };

            registerActiveAudioSystem(fakeAudio);
            handleAudioFocusChange({ focused: false, duck: false });
            expect(volumeScale).toBe(0.0);
        });

        it('restores full volume (1.0) on focus gain', () => {
            let volumeScale = 0.0;
            const fakeAudio: LifecycleAudioSystemTarget = {
                setMasterVolumeScale: (scale: number) => {
                    volumeScale = scale;
                }
            };

            registerActiveAudioSystem(fakeAudio);
            handleAudioFocusChange({ focused: true, duck: false });
            expect(volumeScale).toBe(1.0);
        });
    });

    describe('Lifecycle & Autosave', () => {
        it('triggers autosave on pause event', () => {
            let autosaveCalled = false;
            registerAutosaveHandler(() => {
                autosaveCalled = true;
            });

            handleLifecycleEvent({ type: 'pause' });
            expect(autosaveCalled).toBe(true);
        });

        it('triggers autosave on stop event', () => {
            let screenAutosaveCalled = false;
            registerActiveGameScreen({
                triggerBackgroundAutosave: () => {
                    screenAutosaveCalled = true;
                }
            });

            handleLifecycleEvent({ type: 'stop' });
            expect(screenAutosaveCalled).toBe(true);
        });

        it('does not trigger autosave on resume event', () => {
            let autosaveCalled = false;
            registerAutosaveHandler(() => {
                autosaveCalled = true;
            });

            handleLifecycleEvent({ type: 'resume' });
            expect(autosaveCalled).toBe(false);
        });
    });

    describe('Window Hook Installation', () => {
        it('installs all global __RA2_*__ hooks on window', () => {
            (globalThis as any).window = globalThis;
            installNativeLifecycleListeners();

            expect(typeof (globalThis as any).__RA2_ON_BACK_PRESSED__).toBe('function');
            expect(typeof (globalThis as any).__RA2_AUDIO_FOCUS__).toBe('function');
            expect(typeof (globalThis as any).__RA2_LIFECYCLE__).toBe('function');
            expect(typeof (globalThis as any).__RA2_AUTOSAVE__).toBe('function');
        });
    });
});
