import Foundation

enum PayKind: String { case straight, overtime, double }

struct ShiftSplit {
    var st: Double = 0
    var ot: Double = 0
    var dt: Double = 0
    var filler: Double = 0
    var fillerKind: PayKind = .straight
    var worked: Double { st + ot + dt }
    var paid: Double { worked + filler }
}

struct PayLine: Identifiable {
    let id = UUID()
    let label: String
    let hours: Double
    let rate: Double
    var amount: Double { hours * rate }
}

struct ShiftPay {
    let split: ShiftSplit
    let lines: [PayLine]
    var total: Double { lines.reduce(0) { $0 + $1.amount } }
}

struct PayWeek: Identifiable {
    let start: Date
    let shifts: [Shift]
    let pays: [ShiftPay]
    var id: Date { start }
    var gross: Double { pays.reduce(0) { $0 + $1.total } }
    var hours: Double { pays.reduce(0) { $0 + $1.split.paid } }
    var st: Double { pays.reduce(0) { $0 + $1.split.st } }
    var ot: Double { pays.reduce(0) { $0 + $1.split.ot } }
    var dt: Double { pays.reduce(0) { $0 + $1.split.dt } }
    var filler: Double { pays.reduce(0) { $0 + $1.split.filler } }
}

/// Mirrors web/app.js so both apps give the same number.
enum PayEngine {
    static func split(_ s: Shift, rates r: Rates, calendar cal: Calendar = .current) -> ShiftSplit {
        var out = ShiftSplit()
        if s.manual {
            out.st = s.manualST; out.ot = s.manualOT; out.dt = s.manualDT
            out.fillerKind = out.st > 0 ? .straight : (out.ot > 0 ? .overtime : .double)
        } else {
            var end = s.end
            if end <= s.start { end = end.addingTimeInterval(86_400) }
            var t = s.start
            var first = true
            while t < end {
                let c = cal.dateComponents([.weekday, .hour, .minute], from: t)
                let wd = c.weekday ?? 2
                let m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
                let kind: PayKind
                if s.holiday || (wd == 1 && r.sundayDouble) { kind = .double }
                else if (2...6).contains(wd) && m >= r.straightStartMinutes && m < r.straightEndMinutes { kind = .straight }
                else { kind = .overtime }
                if first { out.fillerKind = kind; first = false }
                switch kind {
                case .straight: out.st += 0.25
                case .overtime: out.ot += 0.25
                case .double: out.dt += 0.25
                }
                t = t.addingTimeInterval(15 * 60)
            }
            var brk = max(0, s.breakHours)
            let a = min(out.st, brk); out.st -= a; brk -= a
            let b = min(out.ot, brk); out.ot -= b; brk -= b
            out.dt = max(0, out.dt - brk)
        }
        if out.worked > 0 && out.worked < r.guaranteeHours { out.filler = r.guaranteeHours - out.worked }
        return out
    }

    static func pay(_ s: Shift, rates r: Rates) -> ShiftPay {
        let sp = split(s, rates: r)
        let rate = r.base + s.differential
        var lines = [
            PayLine(label: "Straight time", hours: sp.st, rate: rate),
            PayLine(label: "Overtime x\(r.otMultiplier.clean)", hours: sp.ot, rate: rate * r.otMultiplier),
            PayLine(label: "Double time x\(r.dtMultiplier.clean)", hours: sp.dt, rate: rate * r.dtMultiplier),
        ]
        if sp.filler > 0 {
            let mult: Double = sp.fillerKind == .straight ? 1 : (sp.fillerKind == .overtime ? r.otMultiplier : r.dtMultiplier)
            lines.append(PayLine(label: "Guarantee (\(r.guaranteeHours.clean) hr min)", hours: sp.filler, rate: rate * mult))
        }
        return ShiftPay(split: sp, lines: lines.filter { $0.hours > 0 })
    }

    static func weekStart(for date: Date, rates r: Rates) -> Date {
        var cal = Calendar.current
        cal.firstWeekday = r.weekStartsOn
        return cal.dateInterval(of: .weekOfYear, for: date)?.start ?? cal.startOfDay(for: date)
    }

    static func weeks(_ shifts: [Shift], rates r: Rates) -> [PayWeek] {
        let grouped = Dictionary(grouping: shifts) { weekStart(for: $0.start, rates: r) }
        return grouped.keys.sorted(by: >).map { k in
            let list = grouped[k]!.sorted { $0.start < $1.start }
            return PayWeek(start: k, shifts: list, pays: list.map { pay($0, rates: r) })
        }
    }

    static func contractYearStart(_ now: Date = .now) -> Date {
        let cal = Calendar.current
        let y = cal.component(.year, from: now)
        let m = cal.component(.month, from: now)
        return cal.date(from: DateComponents(year: m >= 10 ? y : y - 1, month: 10, day: 1)) ?? now
    }

    static func disputeNote(_ w: PayWeek, stubGross: Double, rates r: Rates) -> String {
        let df = DateFormatter(); df.dateFormat = "EEE MMM d HH:mm"
        var lines = ["Pay question - week of \(w.start.formatted(date: .abbreviated, time: .omitted))",
                     "Expected gross: \(w.gross.money)  Stub gross: \(stubGross.money)  Short: \((w.gross - stubGross).money)"]
        for (s, p) in zip(w.shifts, w.pays) {
            var l = "- \(df.string(from: s.start))-\(s.end.formatted(date: .omitted, time: .shortened)) \(s.terminal)"
            if !s.vessel.isEmpty { l += " / \(s.vessel)" }
            if !s.gang.isEmpty { l += " / \(s.gang)" }
            l += ": \(p.split.st.clean) ST, \(p.split.ot.clean) OT, \(p.split.dt.clean) DT"
            if p.split.filler > 0 { l += ", \(p.split.filler.clean) guarantee" }
            l += " = \(p.total.money)"
            lines.append(l)
        }
        lines.append("Rate used: \(r.base.money)/h base.")
        return lines.joined(separator: "\n")
    }
}

extension Double {
    var money: String { formatted(.currency(code: "USD")) }
    var clean: String { truncatingRemainder(dividingBy: 1) == 0 ? String(Int(self)) : String(format: "%.2f", self) }
}
