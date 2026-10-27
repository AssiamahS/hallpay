import SwiftUI
import SwiftData

enum AppSection: String, CaseIterable, Identifiable {
    case shifts, paycheck, royalty, cards, rates
    var id: String { rawValue }
    var title: String {
        switch self {
        case .shifts: "Shifts"
        case .paycheck: "Paycheck"
        case .royalty: "Royalty"
        case .cards: "Cards"
        case .rates: "Rates"
        }
    }
    var icon: String {
        switch self {
        case .shifts: "clock.badge.checkmark"
        case .paycheck: "dollarsign.arrow.circlepath"
        case .royalty: "shippingbox"
        case .cards: "person.text.rectangle"
        case .rates: "slider.horizontal.3"
        }
    }
}

/// Three columns on the iPhone Duo inner display (section / list / detail),
/// collapsing to a push stack on the 5.4" outer display. Selection lives in
/// SceneStorage so folding or unfolding mid-edit lands on the same shift.
struct ContentView: View {
    @SceneStorage("section") private var sectionRaw = AppSection.shifts.rawValue
    @SceneStorage("selShift") private var selShiftRaw = ""
    @SceneStorage("selWeek") private var selWeekRaw: Double = 0
    @SceneStorage("selCard") private var selCardRaw = ""
    @State private var columns: NavigationSplitViewVisibility = .all

    @Query(sort: \Shift.start, order: .reverse) private var shifts: [Shift]
    @Query(sort: \Card.expires) private var cards: [Card]
    @AppStorage(RatesKey.name) private var ratesData = Data()

    private var rates: Rates { Rates.decode(ratesData) }

    private var section: Binding<AppSection?> {
        Binding(get: { AppSection(rawValue: sectionRaw) ?? .shifts },
                set: { sectionRaw = ($0 ?? .shifts).rawValue })
    }
    private var selShift: Binding<UUID?> {
        Binding(get: { UUID(uuidString: selShiftRaw) }, set: { selShiftRaw = $0?.uuidString ?? "" })
    }
    private var selWeek: Binding<Date?> {
        Binding(get: { selWeekRaw == 0 ? nil : Date(timeIntervalSince1970: selWeekRaw) },
                set: { selWeekRaw = $0?.timeIntervalSince1970 ?? 0 })
    }
    private var selCard: Binding<UUID?> {
        Binding(get: { UUID(uuidString: selCardRaw) }, set: { selCardRaw = $0?.uuidString ?? "" })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List(AppSection.allCases, selection: section) { s in
                Label(s.title, systemImage: s.icon)
                    .badge(s == .cards ? cards.filter { $0.daysLeft <= 60 }.count : 0)
                    .tag(s)
            }
            .navigationTitle("HallPay")
        } content: {
            switch section.wrappedValue ?? .shifts {
            case .shifts: ShiftListView(selection: selShift, rates: rates)
            case .paycheck: PaycheckListView(selection: selWeek, rates: rates)
            case .royalty: RoyaltyView(rates: rates)
            case .cards: CardListView(selection: selCard)
            case .rates: RatesView()
            }
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder private var detail: some View {
        switch section.wrappedValue ?? .shifts {
        case .shifts:
            if let s = shifts.first(where: { $0.id == selShift.wrappedValue }) {
                ShiftDetailView(shift: s, rates: rates).id(s.id)
            } else {
                Placeholder(title: "Pick a shift", text: "Unfolded, the log stays on the left and the pay breakdown on the right.", icon: "clock")
            }
        case .paycheck:
            if let d = selWeek.wrappedValue, let w = PayEngine.weeks(shifts, rates: rates).first(where: { $0.start == d }) {
                PaycheckDetailView(week: w, rates: rates).id(d)
            } else {
                Placeholder(title: "Pick a week", text: "Type the gross from your stub. HallPay shows the gap and writes the note for your steward.", icon: "doc.text.magnifyingglass")
            }
        case .royalty:
            RoyaltyMonthsView()
        case .cards:
            if let c = cards.first(where: { $0.id == selCard.wrappedValue }) {
                CardDetailView(card: c).id(c.id)
            } else {
                Placeholder(title: "Pick a card", text: "TWIC, crane, forklift, hazmat. Anything inside 60 days is flagged.", icon: "person.text.rectangle")
            }
        case .rates:
            Placeholder(title: "Your numbers", text: "Rates come from your local's sheet. The default $40 is only an example. Data never leaves this phone.", icon: "lock.shield")
        }
    }
}

struct Placeholder: View {
    let title: String
    let text: String
    let icon: String
    var body: some View {
        ContentUnavailableView(title, systemImage: icon, description: Text(text))
    }
}
