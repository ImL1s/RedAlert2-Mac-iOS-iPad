import { Page, test as base } from '@playwright/test';

export interface Ra2ShellState {
  platform: 'android' | 'ios' | 'browser';
  version: string;
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
  lowPowerMode: boolean;
  persistedSafUri: string | null;
}

export interface PowerUpdatePayload {
  thermal?: 'nominal' | 'fair' | 'serious' | 'critical';
  lowPower?: boolean;
}

export interface MockShellBridgeOptions {
  platform?: 'android' | 'ios' | 'browser';
  version?: string;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
  lowPowerMode?: boolean;
  persistedSafUri?: string | null;
}

declare global {
  interface Window {
    __RA2_SHELL__?: {
      platform: string;
      version: string;
      thermalState: string;
      lowPowerMode: boolean;
      persistedSafUri: string | null;
      getPersistedSafUri?: () => string | null;
      requestSafPicker?: () => Promise<string | null>;
      [key: string]: any;
    };
    __RA2_POWER__?: ((arg: any) => void) & {
      listeners?: Array<(data: PowerUpdatePayload) => void>;
      dispatch?: (data: PowerUpdatePayload) => void;
      register?: (fn: (data: PowerUpdatePayload) => void) => () => void;
    };
  }
}

/**
 * Injects window.__RA2_SHELL__ and window.__RA2_POWER__ into Playwright page before scripts run.
 */
export async function injectMockShellBridge(page: Page, options: MockShellBridgeOptions = {}) {
  const defaultState: Ra2ShellState = {
    platform: options.platform ?? 'android',
    version: options.version ?? '0.1.0',
    thermalState: options.thermalState ?? 'nominal',
    lowPowerMode: options.lowPowerMode ?? false,
    persistedSafUri: options.persistedSafUri ?? null,
  };

  await page.addInitScript((initialState) => {
    // Define window.__RA2_SHELL__
    window.__RA2_SHELL__ = {
      ...initialState,
      getPersistedSafUri: function () {
        return window.__RA2_SHELL__?.persistedSafUri ?? null;
      },
      requestSafPicker: async function () {
        return 'content://com.android.externalstorage.documents/tree/primary%3ARedAlert2';
      },
    };

    // Setup window.__RA2_POWER__ dual-functionality (register listener OR dispatch update)
    const listeners: Array<(data: any) => void> = [];

    const powerFunction: any = function (arg: any) {
      if (typeof arg === 'function') {
        // Callback registration mode
        listeners.push(arg);
        return function unregister() {
          const idx = listeners.indexOf(arg);
          if (idx !== -1) listeners.splice(idx, 1);
        };
      } else if (arg && typeof arg === 'object') {
        // Event dispatch mode
        if (arg.thermal && window.__RA2_SHELL__) {
          window.__RA2_SHELL__.thermalState = arg.thermal;
        }
        if (typeof arg.lowPower === 'boolean' && window.__RA2_SHELL__) {
          window.__RA2_SHELL__.lowPowerMode = arg.lowPower;
        }

        // Notify listeners, catching exceptions so remaining listeners still run
        for (const listener of [...listeners]) {
          try {
            listener(arg);
          } catch (err) {
            console.error('[MockPowerBridge] Listener threw error:', err);
          }
        }
      }
    };

    powerFunction.listeners = listeners;
    powerFunction.dispatch = (data: any) => powerFunction(data);

    window.__RA2_POWER__ = powerFunction;
  }, defaultState);
}

/**
 * Dispatch power update payload to window.__RA2_POWER__ inside page context.
 */
export async function dispatchPowerEvent(page: Page, payload: PowerUpdatePayload) {
  return await page.evaluate((data) => {
    if (typeof window.__RA2_POWER__ === 'function') {
      window.__RA2_POWER__(data);
    }
  }, payload);
}

/**
 * Retrieve current shell bridge state from page.
 */
export async function getShellState(page: Page): Promise<Ra2ShellState | null> {
  return await page.evaluate(() => {
    if (!window.__RA2_SHELL__) return null;
    return {
      platform: window.__RA2_SHELL__.platform as any,
      version: window.__RA2_SHELL__.version,
      thermalState: window.__RA2_SHELL__.thermalState as any,
      lowPowerMode: window.__RA2_SHELL__.lowPowerMode,
      persistedSafUri: window.__RA2_SHELL__.persistedSafUri,
    };
  });
}

/**
 * Playwright fixture extending base test with mockShell.
 */
export const test = base.extend<{
  mockShell: {
    inject: (options?: MockShellBridgeOptions) => Promise<void>;
    dispatchPower: (payload: PowerUpdatePayload) => Promise<void>;
    getState: () => Promise<Ra2ShellState | null>;
  };
}>({
  mockShell: async ({ page }, use) => {
    const fixture = {
      inject: (options?: MockShellBridgeOptions) => injectMockShellBridge(page, options),
      dispatchPower: (payload: PowerUpdatePayload) => dispatchPowerEvent(page, payload),
      getState: () => getShellState(page),
    };
    await use(fixture);
  },
});

export { expect } from '@playwright/test';
