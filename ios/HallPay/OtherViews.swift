import SwiftUI
import SwiftData

// MARK: - Paycheck

struct PaycheckListView: View {
    @Binding var selection: Date?
    let rates: Rates
    @Query private var shifts: [Shift]
    @Query private var stubs: [StubEntry]

    var body: some View {
        let weeks = PayEngine.weeks(shifts, rates: rates)
        List(selection: $selection) {
            if weeks.isEmpty {
                ContentUnavailableView("No weeks yet", systemImage: "doc.text", description: Text("Log shifts first. Each pay week shows up here."))
            }
            ForEach(weeks) { w in
                let v = Verdict(week: w, stub: stubs.first { $0.weekStart == w.start }, tolerance: rates.tolerance)
                HStack {
                    Rectangle().fill(v.color).frame(width: 4)
                    VStack(alignment: .leading) {
                        Text("Week of \(w.start.formatted(.dateTime.month(.abbreviated).day()))").font(.headline)
                        Text("\(w.shifts.count) shifts · \(v.text)").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(w.gross.money).monospacedDigit()
                }
                .tag(w.start)
            }
        }
        .navigationTitle("Paycheck check")
    }
}

struct Verdict {
    let text: String
    let color: Color
    let short: Double

    init(week: PayWeek, stub: StubEntry?, tolerance: Double) {
        guard let stub, stub.gross > 0 else {
            text = "No stub entered"; color = .secondary; short = 0; return
        }
        let diff = stub.gross - week.gross
        if abs(diff) <= tolerance { text = "Matches"; color = Theme.green; short = 0 }
        else if diff < 0 { text = "Short \((-diff).money)"; color = Theme.red; short = -diff }
        else { text = "Over \(diff.money)"; color = Theme.yellow; short = 0 }
    }
}

struct PaycheckDetailView: View {
    let week: PayWeek
    let rates: Rates
    @Environment(\.modelContext) private var context
    @Query private var stubs: [StubEntry]

    private var stub: StubEntry? { stubs.first { $0.weekStart == week.start } }

    var body: some View {
        let v = Verdict(week: week, stub: stub, tolerance: rates.tolerance)
        Form {
            Section {
                PayTicket(title: "Expected", lines: [
                    PayLine(label: "Straight time", hours: week.st, rate: 0),
                    PayLine(label: "Overtime", hours: week.ot, rate: 0),
                    PayLine(label: "Double time", hours: week.dt, rate: 0),
                    PayLine(label: "Guarantee", hours: week.filler, rate: 0),
                ].filter { $0.hours > 0 }, total: week.gross)
            }
            Section("Shifts") {
                ForEach(week.shifts.indices, id: \.self) { i in
                    LabeledContent(week.shifts[i].start.formatted(.dateTime.weekday().month().day()) + " " + week.shifts[i].terminal,
                                   value: week.pays[i].total.money)
                }
            }
            Section("What your stub says") {
                LabeledContent("Stub gross $") {
                    TextField("0.00", value: binding(\.gross), format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
                LabeledContent("Stub hours") {
                    TextField("0", value: binding(\.hours), format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
            }
            Section {
                Label(v.text, systemImage: v.short > 0 ? "exclamationmark.triangle.fill" : "checkmark.seal")
                    .foregroundStyle(v.color)
                    .font(.headline)
                if let stub, stub.hours > 0, abs(stub.hours - week.hours) > 0.01 {
                    Text("Stub shows \(stub.hours.clean) h, your log shows \(week.hours.clean) h.").foregroundStyle(.secondary)
                }
                if v.short > 0, let stub {
                    ShareLink(item: PayEngine.disputeNote(week, stubGross: stub.gross, rates: rates)) {
                        Label("Send note to my steward", systemImage: "square.and.arrow.up")
                    }
                }
            } footer: {
                Text("Differences under \(rates.tolerance.money) are ignored.")
            }
        }
        .navigationTitle("Week of \(week.start.formatted(.dateTime.month(.abbreviated).day()))")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func binding(_ kp: ReferenceWritableKeyPath<StubEntry, Double>) -> Binding<Double> {
        Binding(get: { stub?[keyPath: kp] ?? 0 }, set: { newValue in
            let s = stub ?? {
                let n = StubEntry(weekStart: week.start)
                context.insert(n)
                return n
            }()
            s[keyPath: kp] = newValue
        })
    }
}

// MARK: - Royalty

struct RoyaltyView: View {
    let rates: Rates
    @Query private var shifts: [Shift]
    @AppStorage(RatesKey.name) private var ratesData = Data()

    var body: some View {
        let cy = PayEngine.contractYearStart()
        let logged = shifts.filter { $0.start >= cy }.reduce(0) { $0 + PayEngine.split($1, rates: rates).paid }
        let total = logged + rates.priorHours
        let elapsed = max(1, Date.now.timeIntervalSince(cy) / 86_400)
        let pace = total / elapsed * 365
        List {
            Section {
                LabeledContent("Credited hours", value: total.clean)
                LabeledContent("Year-end pace", value: "\(Int(pace))")
                LabeledContent("Est. royalty", value: rates.royaltyPerHour > 0 ? (total * rates.royaltyPerHour).money : "-")
                ProgressView(value: min(total, rates.royaltyMinimum), total: max(1, rates.royaltyMinimum)) {
                    Text(total >= rates.royaltyMinimum ? "Qualified" : "\((rates.royaltyMinimum - total).clean) hours to \(rates.royaltyMinimum.clean)")
                }
                .tint(Theme.yellow)
            } header: {
                Text("Contract year from \(cy.formatted(.dateTime.month().year()))")
            } footer: {
                Text("Threshold and $/hr differ by port. Set yours below. This is an estimate, not the fund's number.")
            }
            Section("Settings") {
                numberRow("Qualifying hours", \.royaltyMinimum)
                numberRow("Est. $ per hour", \.royaltyPerHour)
                numberRow("Hours before HallPay", \.priorHours)
            }
        }
        .navigationTitle("Container royalty")
    }

    private func numberRow(_ label: String, _ kp: WritableKeyPath<Rates, Double>) -> some View {
        LabeledContent(label) {
            TextField("0", value: Binding(get: { Rates.decode(ratesData)[keyPath: kp] }, set: {
                var r = Rates.decode(ratesData); r[keyPath: kp] = $0; ratesData = r.encoded
            }), format: .number)
            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
        }
    }
}

struct RoyaltyMonthsView: View {
    @Query(sort: \Shift.start) private var shifts: [Shift]
    @AppStorage(RatesKey.name) private var ratesData = Data()

    var body: some View {
        let rates = Rates.decode(ratesData)
        let cy = PayEngine.contractYearStart()
        let cal = Calendar.current
        let grouped = Dictionary(grouping: shifts.filter { $0.start >= cy }) {
            cal.date(from: cal.dateComponents([.year, .month], from: $0.start)) ?? $0.start
        }
        List {
            if grouped.isEmpty {
                ContentUnavailableView("No hours this contract year", systemImage: "shippingbox")
            }
            ForEach(grouped.keys.sorted(), id: \.self) { m in
                LabeledContent(m.formatted(.dateTime.month(.wide).year()),
                               value: "\(grouped[m]!.reduce(0) { $0 + PayEngine.split($1, rates: rates).paid }.clean) h")
            }
        }
        .navigationTitle("Hours by month")
    }
}

// MARK: - Cards

struct CardListView: View {
    @Binding var selection: UUID?
    @Environment(\.modelContext) private var context
    @Query(sort: \Card.expires) private var cards: [Card]

    var body: some View {
        List(selection: $selection) {
            if cards.isEmpty {
                ContentUnavailableView("No cards yet", systemImage: "person.text.rectangle", description: Text("Start with your TWIC expiration date."))
            }
            ForEach(cards) { c in
                HStack {
                    VStack(alignment: .leading) {
                        Text(c.name.isEmpty ? "Card" : c.name).font(.headline)
                        Text(c.expires.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(c.daysLeft < 0 ? "EXPIRED" : "\(c.daysLeft)d")
                        .font(.callout.monospacedDigit().weight(.semibold))
                        .foregroundStyle(c.daysLeft < 0 ? Theme.red : (c.daysLeft <= 60 ? Theme.yellow : Theme.green))
                }
                .tag(c.id)
            }
            .onDelete { idx in idx.forEach { context.delete(cards[$0]) } }
        }
        .navigationTitle("Cards & certs")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add card", systemImage: "plus") {
                    let c = Card(name: cards.contains { $0.name == "TWIC" } ? "" : "TWIC")
                    context.insert(c)
                    selection = c.id
                }
            }
        }
    }
}

struct CardDetailView: View {
    @Bindable var card: Card

    var body: some View {
        Form {
            TextField("Card (TWIC, crane, forklift...)", text: $card.name)
            TextField("Number", text: $card.number)
            DatePicker("Expires", selection: $card.expires, displayedComponents: .date)
        }
        .navigationTitle(card.name.isEmpty ? "Card" : card.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Rates

struct RatesView: View {
    @AppStorage(RatesKey.name) private var ratesData = Data()

    private var r: Binding<Rates> {
        Binding(get: { Rates.decode(ratesData) }, set: { ratesData = $0.encoded })
    }

    var body: some View {
        Form {
            Section {
                num("Base $/hr (straight)", r.base)
                num("OT multiplier", r.otMultiplier)
                num("DT multiplier", r.dtMultiplier)
                num("Guarantee hrs / call", r.guaranteeHours)
            } footer: {
                Text("Enter your local's rate sheet. The default $40 is only an example.")
            }
            Section("Straight-time window (Mon-Fri)") {
                DatePicker("Starts", selection: minutes(r.straightStartMinutes), displayedComponents: .hourAndMinute)
                DatePicker("Ends", selection: minutes(r.straightEndMinutes), displayedComponents: .hourAndMinute)
                Toggle("Sundays pay double time", isOn: r.sundayDouble)
                Picker("Pay week starts", selection: r.weekStartsOn) {
                    ForEach(1...7, id: \.self) { d in Text(Calendar.current.weekdaySymbols[d - 1]).tag(d) }
                }
                num("Ignore stub gaps under $", r.tolerance)
            }
            Section {
                Text("Everything stays on this phone. Not affiliated with the ILA, ILWU, USMX or PMA.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Rates")
    }

    private func num(_ label: String, _ value: Binding<Double>) -> some View {
        LabeledContent(label) {
            TextField("0", value: value, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
        }
    }

    private func minutes(_ m: Binding<Int>) -> Binding<Date> {
        Binding(get: {
            Calendar.current.startOfDay(for: .now).addingTimeInterval(Double(m.wrappedValue) * 60)
        }, set: {
            let c = Calendar.current.dateComponents([.hour, .minute], from: $0)
            m.wrappedValue = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        })
    }
}
