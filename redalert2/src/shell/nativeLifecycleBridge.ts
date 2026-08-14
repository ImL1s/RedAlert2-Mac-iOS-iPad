/**
 * Native Lifecycle, Back Navigation, Audio Focus, and Autosave Bridge.
 *
 * Coordinates platform-level events from Android Activity / iOS host with
 * the web game engine.
 */

export interface RA2AudioFocusEvent {
    focused: boolean;
    duck: boolean;
}

export interface RA2LifecycleEvent {
    type: 'resume' | 'pause' | 'stop' | 'destroy';
}

export interface LifecycleGameScreenTarget {
    isMenuOpen?(): boolean;
    openMenu?(): void;
    closeMenu?(): void;
    triggerBackgroundAutosave?(): void;
}

export interface LifecycleAudioSystemTarget {
    setMasterVolumeScale(scale: number): void;
}

export interface BackNavigationHandler {
    handleBackPressed(): boolean;
}

let activeGameScreen: LifecycleGameScreenTarget | undefined;
let activeAudioSystem: LifecycleAudioSystemTarget | undefined;
let activeBackHandler: BackNavigationHandler | undefined;
let customAutosaveHandler: (() => void) | undefined;

declare global {
    interface Window {
        __RA2_ON_BACK_PRESSED__?: () => boolean | void;
        __RA2_AUDIO_FOCUS__?: (event: RA2AudioFocusEvent) => void;
        __RA2_LIFECYCLE__?: (event: RA2LifecycleEvent) => void;
        __RA2_AUTOSAVE__?: () => void;
    }
}

export function registerActiveGameScreen(screen: LifecycleGameScreenTarget | undefined): void {
    activeGameScreen = screen;
}

export function registerActiveAudioSystem(audio: LifecycleAudioSystemTarget | undefined): void {
    activeAudioSystem = audio;
}

export function registerBackNavigationHandler(handler: BackNavigationHandler | undefined): void {
    activeBackHandler = handler;
}

export function registerAutosaveHandler(handler: (() => void) | undefined): void {
    customAutosaveHandler = handler;
}

export function getActiveGameScreen(): LifecycleGameScreenTarget | undefined {
    return activeGameScreen;
}

export function getActiveAudioSystem(): LifecycleAudioSystemTarget | undefined {
    return activeAudioSystem;
}

/**
 * Handles back navigation event triggered by native host.
 * Returns true if the back event was consumed/handled by game UI.
 */
export function handleBackPressed(): boolean {
    if (activeBackHandler) {
        return activeBackHandler.handleBackPressed();
    }

    if (activeGameScreen) {
        if (activeGameScreen.isMenuOpen?.()) {
            activeGameScreen.closeMenu?.();
            return true;
        } else if (activeGameScreen.openMenu) {
            activeGameScreen.openMenu();
            return true;
        }
    }

    return false;
}

/**
 * Handles audio focus changes (ducking or pausing audio).
 */
export function handleAudioFocusChange(event: RA2AudioFocusEvent): void {
    if (!activeAudioSystem) return;

    if (!event.focused && event.duck) {
        activeAudioSystem.setMasterVolumeScale(0.2);
    } else if (!event.focused && !event.duck) {
        activeAudioSystem.setMasterVolumeScale(0.0);
    } else {
        activeAudioSystem.setMasterVolumeScale(1.0);
    }
}

/**
 * Handles lifecycle state transitions (resume, pause, stop, destroy).
 */
export function handleLifecycleEvent(event: RA2LifecycleEvent): void {
    if (event.type === 'pause' || event.type === 'stop') {
        triggerAutosave();
    }
}

/**
 * Triggers background / pre-exit autosave.
 */
export function triggerAutosave(): void {
    if (customAutosaveHandler) {
        customAutosaveHandler();
    }
    if (activeGameScreen?.triggerBackgroundAutosave) {
        activeGameScreen.triggerBackgroundAutosave();
    }
}

/**
 * Installs global bridge window hooks invoked by the native Android / iOS shells.
 */
export function installNativeLifecycleListeners(): void {
    if (typeof window === 'undefined') return;

    window.__RA2_ON_BACK_PRESSED__ = () => {
        return handleBackPressed();
    };

    window.__RA2_AUDIO_FOCUS__ = (event: RA2AudioFocusEvent) => {
        handleAudioFocusChange(event);
    };

    window.__RA2_LIFECYCLE__ = (event: RA2LifecycleEvent) => {
        handleLifecycleEvent(event);
    };

    window.__RA2_AUTOSAVE__ = () => {
        triggerAutosave();
    };
}
