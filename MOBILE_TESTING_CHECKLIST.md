# Mobile Testing Checklist

**None of the checkboxes below have been run.** This document was written in an environment with no Xcode, no Android SDK/Java, no simulator, no emulator, and no physical iPhone or Android phone (see NATIVE_SETUP.md). Everything here is what to actually do once you have real hardware — simulator/emulator testing alone is not sufficient for the background-GPS/audio claims this feature makes, per the spec this was built against, and per plain reality (a simulator cannot walk down a real street, lose real GPS signal, or receive a real phone call).

## Before you start

1. `npm run cap:sync`
2. Set a real GraphHopper key: either point `config.js`'s `NATIVE_API_BASE_URL` at a Cloudflare Pages deployment that has `GRAPHHOPPER_API_KEY` configured (see README.md's "Configuration/secrets"), or accept demo-mode routing for these tests (off-route/reroute/arrival logic all still runs identically on demo-mode routes).
3. Have a route that takes at least 5–10 minutes on foot in an area with real GPS reception (outdoors, not deep indoors).

## iOS — on a real iPhone (Xcode → Window → Devices and Simulators to confirm it's a real device, not the simulator)

- [ ] Navigation begins in the foreground: tap Start, confirm the map/turn banner populate from a real GPS fix.
- [ ] Lock the phone (side button) mid-navigation.
- [ ] Unlock a few minutes later — GPS tracking continued (compare distance-remaining before/after; it should have decreased by a plausible amount, not be frozen).
- [ ] A voice instruction is audible while the phone is locked (not just after unlocking) — walk toward a real turn and listen before unlocking.
- [ ] If ambient sound was enabled before locking, it's still audible while locked (expect the generic noise loop, not the specific soundscape you picked — see IOS_BACKGROUND_NAVIGATION.md).
- [ ] While locked and navigating, receive an actual phone call (or have someone call you) — audio ducks/pauses for the call and **resumes correctly afterward** without needing to reopen the app.
- [ ] In Settings → Privacy & Security → Location Services → Calm Companion, downgrade from "Always" to "While Using" mid-session — confirm the app detects this (an error/state event) rather than silently pretending background is still active.
- [ ] In Settings, turn off Location Services entirely before starting navigation — confirm a clear, specific error, not a crash or infinite spinner.
- [ ] Tap "Stop navigation" from the app itself — confirm the foreground/lock-screen state actually clears (Now Playing info disappears, GPS stops).
- [ ] Walk to the actual destination with the phone locked — confirm arrival is detected and announced while still locked, and check the app's state on unlock (should show "Arrived", not still "Navigating").
- [ ] Background the app (swipe up, don't force-quit) and reopen it after a minute or two — confirm the route/step/marker restore correctly from `getNavigationSnapshot()`, with no duplicate voice announcement of the step you were already on.
- [ ] Separately: force-quit the app mid-navigation (swipe away in the app switcher) and confirm navigation does **not** silently resume — this is expected per IOS_BACKGROUND_NAVIGATION.md, not a bug to fix.

## Android — on a real Android phone

- [ ] The foreground service starts when you tap Start (check for the persistent notification appearing immediately, not delayed).
- [ ] The persistent notification shows the current instruction, distance, and destination.
- [ ] Lock the phone mid-navigation.
- [ ] GPS continues (same before/after distance check as iOS).
- [ ] A voice instruction is audible while locked.
- [ ] Tap "Stop navigation" **from the notification itself** (not from inside the app) — confirm navigation actually ends (service stops, notification disappears).
- [ ] The notification updates as you approach each turn (instruction text and distance actually change, not stuck on the first instruction).
- [ ] Deny location permission entirely (fresh install, deny at the prompt) — confirm a clear, specific in-app message, not a silent failure.
- [ ] On Android 13+: deny the notification permission specifically (allow location, deny notifications) — confirm navigation still functions per ANDROID_BACKGROUND_NAVIGATION.md's documented behavior (service runs; you will not see the notification — verify this is actually true on-device, since it's a documented expectation, not a guarantee).
- [ ] **Battery optimization interference**: on at least one aggressive-OEM device (Xiaomi/MIUI, Huawei, OnePlus/OxygenOS, or Samsung with battery optimization left at its default, non-"unrestricted" setting) — start navigation, lock the phone, and check whether the OS kills the service anyway despite the foreground-service declaration. This is a known, real platform risk (see ANDROID_BACKGROUND_NAVIGATION.md) — document what actually happens, don't assume it works.
- [ ] Force-stop the app from Android Settings → Apps → Calm Companion → Force stop, mid-navigation — confirm the service actually dies (expected) and nothing resurrects it silently.
- [ ] Kill and relaunch the app after backgrounding it (not force-stopping) — confirm no duplicate `LocationManager` listener gets attached (check logcat for two concurrent fix streams, or symptom: instructions/voice firing twice).
- [ ] Walk to the actual destination with the phone locked — confirm arrival is detected/announced while locked.
- [ ] Return to the app from the background (not after force-stop) — confirm state restores from `getNavigationSnapshot()` with no duplicate announcement.

## Build and verification (can be run without a physical device)

1. `npm test` — all 257 existing + new tests should pass.
2. `npm run build:web` — should print a file count with no errors, and its own secret-scan should not abort.
3. `npm run build:plugin` (`tsc --noEmit` equivalent) — should report zero TypeScript errors.
4. `npx cap sync` — should complete without errors and report the `calm-nav-background` plugin found for both platforms.
5. Open `ios/App/App.xcodeproj` in Xcode and attempt a build (⌘B) for a simulator destination first (faster feedback than a device build) — fix any compile errors surfaced. **This has not been done in the authoring environment; expect some.**
6. Open `android/` in Android Studio and attempt a Gradle sync + build — same caveat.
7. Grep the built app bundles for the GraphHopper key as a final sanity check (`grep -r "GRAPHHOPPER" ios/ android/` should only ever match the CORS/documentation comments referencing the key by name, never an actual key value — there should be no key value anywhere in this repo to begin with).
8. Only after 5–6 succeed: install on a real device and work through the iOS/Android checklists above.

## What "done" actually requires

Per this feature's own bar: **do not consider locked-screen GPS or locked-screen audio "working" until the relevant checklist items above have been physically run on a real device and passed.** A clean build is necessary but not sufficient evidence.
