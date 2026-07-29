import { WebPlugin } from '@capacitor/core';

import type {
  CalmNavBackgroundPlugin,
  PermissionStatusResult,
  RequestForegroundResult,
  RequestBackgroundResult,
  StartLocationUpdatesOptions,
  LocationFix,
  StartNavigationSessionOptions,
  StartNavigationSessionResult,
  UpdateNavigationRouteOptions,
  NavigationSnapshot,
  SetMutedOptions,
} from './definitions';

/**
 * Web fallback. app.js never actually calls into this — every call site is
 * gated behind `NavBridge.isNative` (see shared/navigationBridge.js), and the
 * web build uses web/web*.js's own browser-API-based adapters instead. This
 * class exists only because Capacitor's registerPlugin() requires a web
 * implementation to exist at all; every method here fails loudly rather than
 * silently pretending background navigation works on the web platform, which
 * it fundamentally cannot (no background GPS, no lock-screen surface, no
 * foreground-service equivalent in a browser tab).
 */
export class CalmNavBackgroundWeb extends WebPlugin implements CalmNavBackgroundPlugin {
  async getPermissionStatus(): Promise<PermissionStatusResult> {
    return { foreground: 'not-applicable', background: 'not-applicable' };
  }

  async requestForegroundLocationPermission(): Promise<RequestForegroundResult> {
    return { granted: false, reason: 'CalmNavBackground is a native-only plugin; use navigator.geolocation on web.' };
  }

  async requestBackgroundLocationPermission(): Promise<RequestBackgroundResult> {
    return { granted: false, reason: 'Background navigation is not available on the web platform.' };
  }

  async startLocationUpdates(_options: StartLocationUpdatesOptions): Promise<void> {
    throw this.unavailable('CalmNavBackground.startLocationUpdates is not available on web.');
  }

  async stopLocationUpdates(): Promise<void> {
    // No-op rather than throwing: callers may call stop() defensively without
    // having successfully started, and that shouldn't itself be an error.
  }

  async getCurrentPosition(): Promise<LocationFix> {
    throw this.unavailable('CalmNavBackground.getCurrentPosition is not available on web — use navigator.geolocation.');
  }

  async startNavigationSession(_options: StartNavigationSessionOptions): Promise<StartNavigationSessionResult> {
    return { backgrounded: false, reason: 'CalmNavBackground is a native-only plugin.' };
  }

  async stopNavigationSession(): Promise<void> {
    // No-op — see stopLocationUpdates() above.
  }

  async updateNavigationRoute(_options: UpdateNavigationRouteOptions): Promise<void> {
    throw this.unavailable('CalmNavBackground.updateNavigationRoute is not available on web.');
  }

  async getNavigationSnapshot(): Promise<NavigationSnapshot> {
    return { active: false };
  }

  async setMuted(_options: SetMutedOptions): Promise<void> {
    // No-op — the web build mutes via VoiceEngine directly, never through this plugin.
  }
}
