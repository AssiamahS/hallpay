import SwiftUI
import SwiftData

struct ShiftListView: View {
    @Binding var selection: UUID?
    let rates: Rates
    @Environment(\.modelContext) private var context
    @Query(sort: \Shift.start, order: .reverse) private var shifts: [Shift]

    var body: some View {
        let weeks = PayEngine.weeks(shifts, rates: rates)
        List(selection: $selection) {
            if shifts.isEmpty {
                ContentUnavailableView {
                    Label("No shifts yet", systemImage: "clock")
                } description: {
                    Text("Log today's shift, or load a sample week to see the pay check work.")
                } actions: {
                    Button("Load sample week") { loadSample() }
                }
            }
            ForEach(weeks) { w in
                Section {
                    ForEach(Array(w.shifts.indices.reversed()), id: \.self) { i in
                        ShiftRow(shift: w.shifts[i], pay: w.pays[i]).tag(w.shifts[i].id)
                    }
                    .onDelete { idx in
                        let rev = Array(w.shifts.reversed())
                        idx.forEach { context.delete(rev[$0]) }
                    }
                } header: {
                    HStack {
                        Text("Week of \(w.start.formatted(.dateTime.month(.abbreviated).day()))")
                        Spacer()
                        Text(w.gross.money).monospacedDigit()
                    }
                }
            }
        }
        .navigationTitle("Shift log")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Log shift", systemImage: "plus") { addShift() }
            }
        }
    }

    private func addShift() {
        let cal = Calendar.current
        let last = shifts.first
        let day = cal.startOfDay(for: .now)
        let startComps = last.map { cal.dateComponents([.hour, .minute], from: $0.start) } ?? DateComponents(hour: 8, minute: 0)
        let length = last.map { $0.end.timeIntervalSince($0.start) } ?? 9 * 3600
        let start = cal.date(byAdding: startComps, to: day) ?? .now
        let s = Shift(start: start, end: start.addingTimeInterval(length))
        if let last {
            s.terminal = last.terminal; s.gang = last.gang; s.job = last.job
            s.differential = last.differential; s.breakHours = last.breakHours
        }
        context.insert(s)
        selection = s.id
    }

    private func loadSample() {
        let ws = PayEngine.weekStart(for: .now, rates: rates)
        func at(_ day: Int, _ h: Int) -> Date { ws.addingTimeInterval(Double(day) * 86_400 + Double(h) * 3600) }
        let specs: [(Int, Int, Int, String, String, Double, Double)] = [
            (0, 8, 17, "MSC Aurora", "Lasher", 0, 1),
            (1, 8, 20, "MSC Aurora", "Lasher", 0, 1),
            (2, 18, 21, "Maersk Kinloss", "Lasher", 0, 0),
            (5, 7, 15, "CMA CGM Tage", "Crane", 2.5, 1),
        ]
        for sp in specs {
            let s = Shift(start: at(sp.0, sp.1), end: at(sp.0, sp.2))
            s.terminal = "Port Newark - Pier 51"; s.gang = "Gang 7"
            s.vessel = sp.3; s.job = sp.4; s.differential = sp.5; s.breakHours = sp.6
            context.insert(s)
        }
        let stub = StubEntry(weekStart: ws)
        stub.gross = 1446.25; stub.hours = 30
        context.insert(stub)
        let twic = Card(name: "TWIC")
        twic.expires = Date.now.addingTimeInterval(41 * 86_400)
        context.insert(twic)
    }
}

struct ShiftRow: View {
    let shift: Shift
    let pay: ShiftPay

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(shift.start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .font(.headline)
                Text(shift.terminal.isEmpty ? "Terminal" : shift.terminal)
                    .foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Text(pay.total.money).font(.body.monospacedDigit().weight(.semibold))
            }
            Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.vertical, 2)
    }

    private var summary: String {
        var parts = [shift.vessel, shift.gang, shift.job].filter { !$0.isEmpty }
        let sp = pay.split
        if sp.st > 0 { parts.append("\(sp.st.clean) ST") }
        if sp.ot > 0 { parts.append("\(sp.ot.clean) OT") }
        if sp.dt > 0 { parts.append("\(sp.dt.clean) DT") }
        if sp.filler > 0 { parts.append("+\(sp.filler.clean) guar") }
        return parts.joined(separator: " · ")
    }
}

struct ShiftDetailView: View {
    @Bindable var shift: Shift
    let rates: Rates
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let pay = PayEngine.pay(shift, rates: rates)
        Form {
            Section {
                PayTicket(title: "Pay for this shift", lines: pay.lines, total: pay.total)
            } footer: {
                Text("Base \(rates.base.money)/h + diff \(shift.differential.money)/h. Change in Rates.")
            }
            Section("When") {
                DatePicker("Start", selection: $shift.start)
                DatePicker("End", selection: $shift.end)
                LabeledContent("Unpaid break (hrs)") {
                    TextField("0", value: $shift.breakHours, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
                Toggle("Holiday (all double time)", isOn: $shift.holiday)
            }
            Section("Where") {
                TextField("Terminal / pier", text: $shift.terminal)
                TextField("Vessel", text: $shift.vessel)
                TextField("Gang / header", text: $shift.gang)
                TextField("Job / skill", text: $shift.job)
                LabeledContent("Skill differential $/h") {
                    TextField("0", value: $shift.differential, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
            }
            Section {
                Toggle("Enter ST / OT / DT myself", isOn: $shift.manual)
                if shift.manual {
                    hoursField("Straight hrs", $shift.manualST)
                    hoursField("Overtime hrs", $shift.manualOT)
                    hoursField("Double time hrs", $shift.manualDT)
                }
            } footer: {
                Text("Port rules differ. Turn this on when your local splits hours differently.")
            }
            Section("Notes") {
                TextField("Ducket #, foreman, anything that proves the shift", text: $shift.notes, axis: .vertical)
            }
            Section {
                Button("Same again tomorrow", systemImage: "plus.square.on.square") { duplicate() }
                Button("Delete shift", systemImage: "trash", role: .destructive) {
                    context.delete(shift)
                    dismiss()
                }
            }
        }
        .navigationTitle(shift.start.formatted(.dateTime.weekday(.wide).month().day()))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func hoursField(_ label: String, _ value: Binding<Double>) -> some View {
        LabeledContent(label) {
            TextField("0", value: value, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
        }
    }

    private func duplicate() {
        let n = Shift(start: shift.start.addingTimeInterval(86_400), end: shift.end.addingTimeInterval(86_400))
        n.terminal = shift.terminal; n.vessel = shift.vessel; n.gang = shift.gang; n.job = shift.job
        n.differential = shift.differential; n.breakHours = shift.breakHours
        context.insert(n)
    }
}

struct PayTicket: View {
    let title: String
    let lines: [PayLine]
    let total: Double

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title.uppercased()).font(.caption.weight(.heavy)).tracking(1)
                Spacer()
                Text(total.money).font(.headline.monospacedDigit())
            }
            .padding(10)
            .background(Theme.orange)
            .foregroundStyle(.black)
            ForEach(lines) { l in
                HStack {
                    Text(l.label)
                    Spacer()
                    Text("\(l.hours.clean) h × \(l.rate.money)").foregroundStyle(.secondary)
                    Text(l.amount.money).frame(minWidth: 84, alignment: .trailing)
                }
                .font(.callout.monospacedDigit())
                .padding(.horizontal, 10).padding(.vertical, 7)
                Divider()
            }
            HStack {
                Text("Gross owed").bold()
                Spacer()
                Text(total.money).bold()
            }
            .font(.body.monospacedDigit())
            .padding(10)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.quaternary))
        .listRowInsets(EdgeInsets())
    }
}
