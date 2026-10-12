// Plays a pad's sound when it's tapped on the home-screen widget.
// AudioPlaybackIntent (iOS 17+) lets iOS run this in the app's process in the
// background, so the sound plays without opening the app.
// This file must be a member of BOTH targets (App and CalmWidget) in Xcode.

import AppIntents
import AVFoundation

final class PadPlayer {
    static let shared = PadPlayer()
    private var players: [String: AVAudioPlayer] = [:]

    func play(_ file: String) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        if let p = players[file] {
            p.currentTime = 0
            p.play()
            return
        }
        guard let url = Bundle.main.url(forResource: file, withExtension: "wav"),
              let p = try? AVAudioPlayer(contentsOf: url) else { return }
        p.prepareToPlay()
        players[file] = p
        p.play()
    }
}

struct PlayPadIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play pad"
    static var isDiscoverable = false

    @Parameter(title: "Pad") var pad: Pad

    init() {}
    init(pad: Pad) { self.pad = pad }

    func perform() async throws -> some IntentResult {
        PadPlayer.shared.play(pad.file)
        // keep the process alive long enough for the sound to ring out
        try? await Task.sleep(nanoseconds: 1_900_000_000)
        return .result()
    }
}
