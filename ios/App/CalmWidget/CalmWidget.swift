// Calm Companion — Large home-screen widget (2026-10-12)
//
// Top: a map snapshot around you with today's weather doodle (sun, clouds,
//      rain, snow, wind swirls, moon & stars) drawn in the app's crayon style.
//      Tapping it opens the app on the Route tab.
// Bottom: 8 music pads (6 chords + kick + snare) you tap right on the home
//      screen — they play through PlayPadIntent (an AudioPlaybackIntent, iOS 17+)
//      without opening the app.
//
// Widgets can't run continuous animations (Apple's rule); the doodle is redrawn
// whenever the timeline refreshes (~every 30 min) and changes with a smooth
// content transition, and a tapped pad gives a short bounce.

import WidgetKit
import SwiftUI
import MapKit
import CoreLocation
import AppIntents

// MARK: - Weather mood (mirrors weathermood.js in the web app)

enum DayTime: String { case dawn, day, dusk, night }
enum Sky: String { case clear, partly, cloudy, fog }
enum Precip: String { case none, drizzle, rain, snow, storm }
enum Wind: String { case calm, breezy, windy }

struct Mood {
    var time: DayTime = .day
    var sky: Sky = .partly
    var precip: Precip = .none
    var wind: Wind = .calm

    static func from(code: Int, windKmh: Double, isDay: Int, now: Date, sunrise: Date?, sunset: Date?) -> Mood {
        var m = Mood()
        switch code {
        case 45, 48: m.sky = .fog
        case 0: m.sky = .clear
        case 1, 2: m.sky = .partly
        default: m.sky = .cloudy
        }
        if code >= 95 { m.precip = .storm }
        else if (71...77).contains(code) || code == 85 || code == 86 { m.precip = .snow }
        else if (61...67).contains(code) || (80...82).contains(code) { m.precip = .rain }
        else if (51...57).contains(code) { m.precip = .drizzle }
        m.wind = windKmh >= 30 ? .windy : windKmh >= 15 ? .breezy : .calm
        if let rise = sunrise, let set = sunset {
            if now < rise.addingTimeInterval(-1800) || now > set.addingTimeInterval(1800) { m.time = .night }
            else if now < rise.addingTimeInterval(3600) { m.time = .dawn }
            else if now > set.addingTimeInterval(-4500) { m.time = .dusk }
            else { m.time = .day }
        } else {
            m.time = isDay == 0 ? .night : .day
        }
        return m
    }
}

// MARK: - Timeline

struct CalmEntry: TimelineEntry {
    let date: Date
    let mood: Mood
    let map: UIImage?
}

final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var done: ((CLLocation?) -> Void)?
    func get(_ completion: @escaping (CLLocation?) -> Void) {
        if let last = manager.location { completion(last); return }  // widgets get a recent fix cheaply
        done = completion
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.requestLocation()
    }
    func locationManager(_ m: CLLocationManager, didUpdateLocations l: [CLLocation]) { done?(l.last); done = nil }
    func locationManager(_ m: CLLocationManager, didFailWithError e: Error) { done?(nil); done = nil }
}

struct Provider: TimelineProvider {
    private let fallback = CLLocation(latitude: 52.3676, longitude: 4.9041) // Amsterdam

    func placeholder(in context: Context) -> CalmEntry { CalmEntry(date: .now, mood: Mood(), map: nil) }

    func getSnapshot(in context: Context, completion: @escaping (CalmEntry) -> Void) {
        completion(CalmEntry(date: .now, mood: Mood(time: .day, sky: .clear), map: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalmEntry>) -> Void) {
        let size = context.displaySize
        OneShotLocation().get { loc in
            let here = loc ?? fallback
            Task {
                async let mood = fetchMood(here)
                async let map = snapshot(here, size: CGSize(width: size.width, height: size.height * 0.55))
                let entry = CalmEntry(date: .now, mood: await mood, map: await map)
                completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
            }
        }
    }

    private func fetchMood(_ loc: CLLocation) async -> Mood {
        // ~1 km rounding, same privacy rule as the web app.
        let lat = String(format: "%.2f", loc.coordinate.latitude), lon = String(format: "%.2f", loc.coordinate.longitude)
        guard let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)&current=weather_code,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1&timeformat=unixtime") else { return Mood() }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let cur = json?["current"] as? [String: Any] ?? [:]
            let daily = json?["daily"] as? [String: Any] ?? [:]
            let rise = (daily["sunrise"] as? [Double])?.first.map { Date(timeIntervalSince1970: $0) }
            let set = (daily["sunset"] as? [Double])?.first.map { Date(timeIntervalSince1970: $0) }
            return Mood.from(code: cur["weather_code"] as? Int ?? 2,
                             windKmh: cur["wind_speed_10m"] as? Double ?? 0,
                             isDay: cur["is_day"] as? Int ?? 1, now: .now, sunrise: rise, sunset: set)
        } catch { return Mood() }
    }

    private func snapshot(_ loc: CLLocation, size: CGSize) async -> UIImage? {
        let opts = MKMapSnapshotter.Options()
        opts.region = MKCoordinateRegion(center: loc.coordinate, latitudinalMeters: 900, longitudinalMeters: 900)
        opts.size = size
        opts.pointOfInterestFilter = .excludingAll
        return await withCheckedContinuation { cont in
            MKMapSnapshotter(options: opts).start { snap, _ in cont.resume(returning: snap?.image) }
        }
    }
}

// MARK: - Crayon doodles (SwiftUI)

private let ink = Color(red: 45/255, green: 42/255, blue: 62/255)
private let paper = Color(red: 1, green: 250/255, blue: 241/255)
private let crayonYellow = Color(red: 1, green: 216/255, blue: 77/255)
private let crayonOrange = Color(red: 1, green: 159/255, blue: 67/255)
private let crayonPink = Color(red: 1, green: 143/255, blue: 184/255)
private let crayonBlue = Color(red: 124/255, green: 200/255, blue: 1)
private let crayonGreen = Color(red: 126/255, green: 214/255, blue: 122/255)
private let crayonPurple = Color(red: 181/255, green: 140/255, blue: 1)

struct SunDoodle: View {
    var body: some View {
        ZStack {
            ForEach(0..<10, id: \.self) { i in
                Capsule().fill(crayonOrange).frame(width: 4, height: 10)
                    .offset(y: -26).rotationEffect(.degrees(Double(i) * 36))
            }
            Circle().fill(crayonYellow).overlay(Circle().stroke(ink, lineWidth: 2.5)).frame(width: 34, height: 34)
            HStack(spacing: 9) { Circle().fill(ink).frame(width: 3.5, height: 4.5); Circle().fill(ink).frame(width: 3.5, height: 4.5) }.offset(y: -3)
        }
    }
}
struct MoonDoodle: View {
    var body: some View {
        Image(systemName: "moon.fill").font(.system(size: 34)).foregroundStyle(Color(red: 1, green: 243/255, blue: 176/255))
            .shadow(color: ink, radius: 0, x: 1.5, y: 1.5)
    }
}
struct CloudDoodle: View {
    var grey = false
    var body: some View {
        Image(systemName: "cloud.fill").font(.system(size: 40))
            .foregroundStyle(grey ? Color(white: 0.86) : .white)
            .overlay(Image(systemName: "cloud").font(.system(size: 40)).foregroundStyle(ink))
    }
}
struct WeatherDoodle: View {
    let mood: Mood
    var body: some View {
        ZStack(alignment: .topTrailing) {
            if mood.time == .night {
                MoonDoodle().padding(10)
                if mood.sky == .clear || mood.sky == .partly {
                    ForEach(0..<5, id: \.self) { i in
                        Image(systemName: "sparkle").font(.system(size: 10 + CGFloat(i % 2) * 4)).foregroundStyle(crayonYellow)
                            .offset(x: CGFloat(-60 - i * 34), y: CGFloat(8 + (i * 17) % 40))
                    }
                }
            } else if mood.sky == .clear || mood.sky == .partly, mood.precip == .none {
                SunDoodle().padding(14).shadow(color: crayonYellow.opacity(mood.sky == .clear ? 0.9 : 0), radius: 8)
                    .saturation(mood.time == .dusk || mood.time == .dawn ? 1.4 : 1)
            }
            if mood.sky != .clear || mood.precip != .none {
                CloudDoodle(grey: mood.precip != .none || mood.sky == .cloudy).offset(x: -36, y: 18)
            }
            if mood.precip == .rain || mood.precip == .drizzle || mood.precip == .storm {
                ForEach(0..<(mood.precip == .drizzle ? 4 : 8), id: \.self) { i in
                    Capsule().fill(crayonBlue).frame(width: 2.5, height: 10).rotationEffect(.degrees(mood.wind == .windy ? 18 : 0))
                        .offset(x: CGFloat(-30 - (i * 13) % 50), y: CGFloat(56 + (i * 11) % 30))
                }
            }
            if mood.precip == .snow {
                ForEach(0..<7, id: \.self) { i in
                    Image(systemName: "snowflake").font(.system(size: 10)).foregroundStyle(.white).shadow(color: ink, radius: 0.5)
                        .offset(x: CGFloat(-24 - (i * 15) % 60), y: CGFloat(54 + (i * 9) % 34))
                }
            }
            if mood.precip == .storm {
                Image(systemName: "bolt.fill").font(.system(size: 20)).foregroundStyle(crayonYellow).offset(x: -56, y: 60)
            }
            if mood.wind != .calm {
                Image(systemName: "wind").font(.system(size: 22, weight: .semibold)).foregroundStyle(Color(red: 159/255, green: 183/255, blue: 217/255))
                    .offset(x: -110, y: 40)
            }
        }
    }
}

// MARK: - Music pads

enum Pad: String, AppEnum, CaseIterable {
    case C, G, Am, F, Dm, Em, kick, snare
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Pad"
    static var caseDisplayRepresentations: [Pad: DisplayRepresentation] = [
        .C: "C", .G: "G", .Am: "Am", .F: "F", .Dm: "Dm", .Em: "Em", .kick: "Kick", .snare: "Snare",
    ]
    var file: String { self == .kick ? "drum-kick" : self == .snare ? "drum-snare" : "chord-\(rawValue)" }
    var label: String { self == .kick ? "Kick" : self == .snare ? "Snare" : rawValue }
    var color: Color {
        switch self {
        case .C: return crayonPink
        case .G: return crayonYellow
        case .Am: return crayonGreen
        case .F: return crayonBlue
        case .Dm: return crayonPurple
        case .Em: return crayonOrange
        case .kick: return crayonPink.opacity(0.6)
        case .snare: return crayonYellow.opacity(0.6)
        }
    }
}

struct PadButton: View {
    let pad: Pad
    var body: some View {
        Button(intent: PlayPadIntent(pad: pad)) {
            Text(pad.label)
                .font(.custom("Patrick Hand", size: 20).weight(.regular))
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(RoundedRectangle(cornerRadius: 14).fill(pad.color))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(ink, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .invalidatableContent()
    }
}

// MARK: - Widget view

struct CalmWidgetView: View {
    let entry: CalmEntry
    var body: some View {
        VStack(spacing: 10) {
            Link(destination: URL(string: "calmnav://route")!) {
                ZStack(alignment: .bottomLeading) {
                    if let map = entry.map {
                        Image(uiImage: map).resizable().scaledToFill()
                            .saturation(1.3)
                            .overlay(entry.mood.time == .night ? Color.black.opacity(0.35) : Color.clear)
                    } else {
                        paper
                    }
                    Circle().fill(Color.blue).frame(width: 12, height: 12).overlay(Circle().stroke(.white, lineWidth: 2.5))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    WeatherDoodle(mood: entry.mood).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .contentTransition(.opacity)
                    Text("Calm route  →")
                        .font(.custom("Patrick Hand", size: 17)).foregroundStyle(ink)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(paper)).overlay(Capsule().stroke(ink, lineWidth: 1.5))
                        .padding(10)
                }
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(ink, lineWidth: 1.5))
            }
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                GridRow { PadButton(pad: .C); PadButton(pad: .G); PadButton(pad: .Am); PadButton(pad: .F) }
                GridRow { PadButton(pad: .Dm); PadButton(pad: .Em); PadButton(pad: .kick); PadButton(pad: .snare) }
            }
            .frame(maxHeight: 118)
        }
        .containerBackground(for: .widget) {
            // the app's lined paper
            ZStack {
                (entry.mood.time == .night ? Color(red: 30/255, green: 34/255, blue: 51/255) : paper)
                VStack(spacing: 23) { ForEach(0..<16, id: \.self) { _ in Rectangle().fill(crayonBlue.opacity(0.18)).frame(height: 1) } }
            }
        }
    }
}

struct CalmWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CalmWidget", provider: Provider()) { entry in
            CalmWidgetView(entry: entry)
        }
        .configurationDisplayName("Calm map & music")
        .description("The map around you with today's weather, and chord pads you can play right here.")
        .supportedFamilies([.systemLarge])
    }
}

@main
struct CalmWidgetBundle: WidgetBundle {
    var body: some Widget { CalmWidget() }
}
