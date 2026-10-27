import SwiftUI
import SwiftData

@main
struct HallPayApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .tint(Theme.orange)
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [Shift.self, StubEntry.self, Card.self])
    }
}

enum Theme {
    static let orange = Color(red: 1.0, green: 0.416, blue: 0.075)
    static let yellow = Color(red: 0.949, green: 0.761, blue: 0.188)
    static let green = Color(red: 0.235, green: 0.812, blue: 0.557)
    static let red = Color(red: 1.0, green: 0.302, blue: 0.369)
}

/// Shared read/write access to the rate sheet. AppStorage keeps it across fold/unfold and relaunch.
struct RatesKey {
    static let name = "hallpay.rates"
}

