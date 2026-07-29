import type { PluginListenerHandle } from '@capacitor/core';

/**
 * A single GPS fix, in the shape app.js/native/*.js already expect
 * (see shared/interfaces.js's LocationProvider.start() doc comment).
 */
export interface LocationFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  timestampMs: number;
}

export interface PermissionStatusResult {
  /** 'granted' | 'denied' | 'prompt' */
  foreground: string;
  /** 'granted' | 'denied' | 'prompt' | 'not-applicable' (iOS <13 / Android <10 has no separate background grant) */
  background: string;
}

export interface RequestForegroundResult {
  granted: boolean;
  reason?: string;
}

export interface RequestBackgroundResult {
  granted: boolean;
  reason?: string;
}

export interface StartLocationUpdatesOptions {
  /** 'high' is the only value used today (ambient/one-shot use, not the nav loop) — kept as a string, not a boolean, so a future 'balanced'/'low' tier doesn't need a breaking signature change. */
  desiredAccuracy: string;
  distanceFilterM: number;
}

/**
 * Mirrors shared/routeTransfer.js's buildNavRoutePayload() output exactly —
 * see that file for why lat/lon are separate named numbers rather than
 * [lon,lat] tuples at this specific JS -> native boundary.
 */
export interface NavRouteManeuver {
  index: number;
  lat: number;
  lon: number;
  text: string;
  distanceM: number;
  sign: number;
  streetName: string;
  isFinal: boolean;
}

export interface NavRoutePayload {
  version: number;
  createdAtMs: number;
  travelMode: 'walk' | 'bike';
  safetyMode: boolean;
  destination: { label: string; lat: number; lon: number };
  distanceM: number;
  durationMs: number;
  geometry: { lat: number; lon: number }[];
  maneuvers: NavRouteManeuver[];
  roadClassSegments: unknown[];
  thresholds: {
    arriveStepM: number;
    arriveDestM: number;
    offRouteM: number;
    offRouteStreakNeeded: number;
    headingMinSpeedMps: number;
  };
}

export interface StartNavigationSessionOptions {
  route: NavRoutePayload;
  wantsBackground: boolean;
  muted: boolean;
  allowAmbient: boolean;
  apiBaseUrl: string;
}

export interface StartNavigationSessionResult {
  backgrounded: boolean;
  reason?: string;
}

export interface UpdateNavigationRouteOptions {
  route: NavRoutePayload;
}

export interface NavigationSnapshot {
  active: boolean;
  route?: NavRoutePayload;
  stepIdx?: number;
  /** mirrors NavLogic.NavState string values ('idle' | 'navigating' | 'arrived' | ...) */
  state?: string;
  distToNextManeuver?: number;
  distToDestination?: number;
  lastEventAtMs?: number;
  lastAnnouncedStepIdx?: number;
}

export interface SetMutedOptions {
  muted: boolean;
}

/**
 * event.type is one of:
 *   'fix' | 'maneuver' | 'offroute' | 'reroute-needed' | 'rerouted' | 'arrived' | 'error' | 'state'
 * 'fix' events carry `fix`; 'state' events carry `state` (e.g. 'audio-interrupted',
 * 'audio-resumed'); 'error' events carry `message`. See IOS_/ANDROID_BACKGROUND_
 * NAVIGATION.md for exactly when each fires.
 */
export interface NavEvent {
  type: string;
  fix?: LocationFix;
  state?: string;
  message?: string;
  stepIdx?: number;
  distToNextManeuver?: number;
  distToDestination?: number;
  etaMs?: number;
}

/** action is one of 'stop' | 'mute' | 'unmute' | 'open' — see native/nativeNotificationController.js. */
export interface NotificationActionEvent {
  action: string;
}

export interface CalmNavBackgroundPlugin {
  getPermissionStatus(): Promise<PermissionStatusResult>;
  requestForegroundLocationPermission(): Promise<RequestForegroundResult>;
  requestBackgroundLocationPermission(): Promise<RequestBackgroundResult>;

  /** Ambient/one-shot location only — never the active nav loop (see AmbientLocationManager.swift / AmbientLocation.kt). */
  startLocationUpdates(options: StartLocationUpdatesOptions): Promise<void>;
  stopLocationUpdates(): Promise<void>;
  getCurrentPosition(): Promise<LocationFix>;

  startNavigationSession(options: StartNavigationSessionOptions): Promise<StartNavigationSessionResult>;
  stopNavigationSession(): Promise<void>;
  updateNavigationRoute(options: UpdateNavigationRouteOptions): Promise<void>;
  getNavigationSnapshot(): Promise<NavigationSnapshot>;
  setMuted(options: SetMutedOptions): Promise<void>;

  addListener(eventName: 'navEvent', listenerFunc: (event: NavEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'notificationAction',
    listenerFunc: (event: NotificationActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
