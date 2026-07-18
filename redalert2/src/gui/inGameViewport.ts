import { BoxedVar } from '../util/BoxedVar';

/**
 * True while the game (or replay) screen is active. Application uses this on
 * mobile layouts to pick a smaller logical resolution in-game (bigger HUD)
 * than in the 800x600-designed menus.
 */
export const inGameViewportActive = new BoxedVar<boolean>(false);
