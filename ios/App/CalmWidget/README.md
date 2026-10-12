# Calm Companion widget (Large: map + music pads)

The code is ready; it needs **Xcode** (free, Mac App Store) and an **Apple Developer account** to build — the same step as publishing to the App Store.

## What it does
- **Top:** a map of where you are, with today's weather drawn as a crayon doodle (sun, clouds, rain, snow, storm, wind, moon & stars). Tap → opens the app on Route (`calmnav://route`).
- **Bottom:** 8 pads — C, G, Am, F, Dm, Em, Kick, Snare. Tap them right on the home screen; they play without opening the app (iOS 17+ `AudioPlaybackIntent`).
- Refreshes about every 30 minutes. Apple doesn't allow continuous animation in widgets; changes animate as smooth transitions.

## Add it in Xcode (≈10 minutes)
1. `npx cap sync ios`, then open `ios/App/App.xcodeproj` in Xcode.
2. **File → New → Target… → Widget Extension.** Name: `CalmWidget`. Untick "Include Configuration App Intent" and "Live Activity". When asked, **Activate** the scheme.
3. Xcode creates a `CalmWidget` folder with sample files — **delete those sample `.swift` files** and instead add the files in this folder (`CalmWidget.swift`, `PlayPadIntent.swift`, `PatrickHand-Regular.ttf`, `Info.plist`) to the **CalmWidget** target.
4. Select **PlayPadIntent.swift** → File inspector → Target Membership: tick **both App and CalmWidget**.
5. Add the folder `ios/App/App/WidgetSounds` (8 `.wav` files) to the **App** target (and CalmWidget too is fine).
6. CalmWidget target → General → **Minimum Deployments: iOS 17.0**.
7. CalmWidget target → Build Settings → **Info.plist File** → `CalmWidget/Info.plist`.
8. Signing & Capabilities: same Team as the app, for both targets.
9. Run on your iPhone, then long-press the home screen → **+** → *Calm Companion* → **Large** → Add Widget.

The `calmnav://` link scheme is already registered in the app's Info.plist.
Font: Patrick Hand by Patrick Wagesreiter, SIL Open Font License (OFL.txt).
