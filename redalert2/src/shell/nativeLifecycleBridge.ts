import type { AudioSystem } from '../engine/sound/AudioSystem';
import type { GameScreen } from '../gui/screen/game/GameScreen';
import type { RA2AudioFocusEvent, RA2LifecycleEvent } from './nativeBridge';

let activeGameScreen: GameScreen | undefined;
let activeAudioSystem: AudioSystem | undefined;

export function registerActiveGameScreen(screen: GameScreen | undefined): void {
    activeGameScreen = screen;
}

export function registerActiveAudioSystem(audio: AudioSystem | undefined): void {
    activeAudioSystem = audio;
}

export function getActiveGameScreen(): GameScreen | undefined {
    return activeGameScreen;
}

export function getActiveAudioSystem(): AudioSystem | undefined {
    return activeAudioSystem;
}

export function installNativeLifecycleListeners(): void {
    if (typeof window === 'undefined') return;
    window.__RA2_ON_BACK_PRESSED__ = () => {
        if (activeGameScreen) {
            if (activeGameScreen.isMenuOpen()) {
                activeGameScreen.closeMenu();
            } else {
                activeGameScreen.openMenu();
            }
        } else if (window.AndroidNativeBridge?.finishActivity) {
            window.AndroidNativeBridge.finishActivity();
        }
    };

    window.__RA2_AUDIO_FOCUS__ = (event: RA2AudioFocusEvent) => {
        if (!activeAudioSystem) return;
        if (!event.focused && event.duck) {
            activeAudioSystem.setMasterVolumeScale(0.2);
        } else if (!event.focused && !event.duck) {
            activeAudioSystem.setMasterVolumeScale(0.0);
        } else {
            activeAudioSystem.setMasterVolumeScale(1.0);
        }
    };

    window.__RA2_LIFECYCLE__ = (event: RA2LifecycleEvent) => {
        if (event.type === 'stop' || event.type === 'pause') {
            if (activeGameScreen) {
                activeGameScreen.triggerBackgroundAutosave();
            }
        }
    };
}
