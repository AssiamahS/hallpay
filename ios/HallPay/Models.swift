import Foundation
import SwiftData

@Model
final class Shift {
    var id: UUID = UUID()
    var start: Date = Date()
    var end: Date = Date().addingTimeInterval(8 * 3600)
    var terminal: String = ""
    var vessel: String = ""
    var gang: String = ""
    var job: String = ""
    var differential: Double = 0
    var breakHours: Double = 0
    var holiday: Bool = false
    var manual: Bool = false
    var manualST: Double = 0
    var manualOT: Double = 0
    var manualDT: Double = 0
    var notes: String = ""

    init(start: Date, end: Date) {
        self.id = UUID()
        self.start = start
        self.end = end
    }
}

/// What the pay stub said for one pay week.
@Model
final class StubEntry {
    var weekStart: Date = Date()
    var gross: Double = 0
    var hours: Double = 0

    init(weekStart: Date) {
        self.weekStart = weekStart
    }
}

@Model
final class Card {
    var id: UUID = UUID()
    var name: String = ""
    var number: String = ""
    var expires: Date = Date().addingTimeInterval(365 * 86_400)

    init(name: String) {
        self.id = UUID()
        self.name = name
    }

    var daysLeft: Int {
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: expires)).day ?? 0
    }
}

/// User-entered contract numbers. Stored as JSON in AppStorage so it survives fold, relaunch, and scene changes.
struct Rates: Codable, Equatable {
    var base: Double = 40          // EXAMPLE - enter your local's straight-time rate
    var otMultiplier: Double = 1.5
    var dtMultiplier: Double = 2
    var straightStartMinutes: Int = 8 * 60
    var straightEndMinutes: Int = 17 * 60
    var guaranteeHours: Double = 4
    var weekStartsOn: Int = 2      // Calendar weekday: 1 Sun ... 7 Sat
    var sundayDouble: Bool = false
    var royaltyPerHour: Double = 0
    var royaltyMinimum: Double = 700
    var priorHours: Double = 0
    var tolerance: Double = 1

    static func decode(_ data: Data) -> Rates {
        (try? JSONDecoder().decode(Rates.self, from: data)) ?? Rates()
    }

    var encoded: Data { (try? JSONEncoder().encode(self)) ?? Data() }
}
