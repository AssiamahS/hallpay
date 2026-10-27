/* HallPay web: shift log, pay check, royalty hours, card expirations.
   Everything lives in localStorage on this device. No server, no account. */
(function () {
  "use strict";

  const KEY = "hallpay.v1";
  const UIKEY = "hallpay.ui";
  const CFG = window.HALLPAY_CONFIG || {};
  const DAY = 86400000;

  const DEFAULT_RATES = {
    base: 40,          // straight-time $/hr - EXAMPLE, enter your own from your local's sheet
    otMult: 1.5,
    dtMult: 2,
    stStart: "08:00",
    stEnd: "17:00",
    guarantee: 4,      // minimum paid hours per call-out
    weekStart: 1,      // 0 Sun .. 6 Sat
    sundayDT: false,
    royaltyPerHr: 0,   // your own estimate of royalty $ per credited hour
    royaltyMin: 700,   // hours to qualify (varies by port - check yours)
    priorHours: 0,     // hours already credited this contract year before you started logging
    tolerance: 1,      // $ difference ignored when checking a stub
  };

  // ---------- storage ----------
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v || fallback; } catch (e) { return fallback; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode: keep in memory */ }
  }
  function saveUI() {
    try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) { /* ignore */ }
  }

  const db = load(KEY, { shifts: [], stubs: {}, certs: [], rates: {} });
  db.rates = Object.assign({}, DEFAULT_RATES, db.rates);
  db.shifts = db.shifts || []; db.stubs = db.stubs || {}; db.certs = db.certs || [];
  const ui = Object.assign({ tab: "shifts", sel: null }, load(UIKEY, {}));

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const hrs = (n) => (Math.round(n * 100) / 100).toString();
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => iso(new Date());
  function parseDate(s, t) {
    const [y, m, d] = s.split("-").map(Number);
    const [hh, mm] = (t || "00:00").split(":").map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0);
  }
  const mins = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
  const fmtDay = (s) => parseDate(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  function weekStartOf(dateStr) {
    const d = parseDate(dateStr);
    const back = (d.getDay() - db.rates.weekStart + 7) % 7;
    return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
  }
  function weekLabel(ws) {
    const s = parseDate(ws), e = new Date(s.getTime() + 6 * DAY);
    const o = { month: "short", day: "numeric" };
    return s.toLocaleDateString(undefined, o) + " - " + e.toLocaleDateString(undefined, o);
  }
  function contractYearStart(ref) {
    const d = ref || new Date();
    const y = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
    return new Date(y, 9, 1);
  }

  // ---------- pay engine ----------
  // Splits a shift into straight / overtime / double-time hours in 15-minute steps.
  function splitShift(s) {
    const r = db.rates;
    let st = 0, ot = 0, dt = 0, first = "st";
    if (s.manual) {
      st = num(s.st); ot = num(s.ot); dt = num(s.dt);
      first = st ? "st" : ot ? "ot" : "dt";
    } else {
      const a = parseDate(s.date, s.start);
      let b = parseDate(s.date, s.end);
      if (b <= a) b = new Date(b.getTime() + DAY);
      const ws = mins(r.stStart), we = mins(r.stEnd);
      let i = 0;
      for (let t = a.getTime(); t < b.getTime(); t += 15 * 60000, i++) {
        const d = new Date(t), dow = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
        let k;
        if (s.holiday || (dow === 0 && r.sundayDT)) k = "dt";
        else if (dow >= 1 && dow <= 5 && m >= ws && m < we) k = "st";
        else k = "ot";
        if (i === 0) first = k;
        if (k === "st") st += 0.25; else if (k === "ot") ot += 0.25; else dt += 0.25;
      }
      let brk = num(s.breakHrs);
      const takeSt = Math.min(st, brk); st -= takeSt; brk -= takeSt;
      const takeOt = Math.min(ot, brk); ot -= takeOt; brk -= takeOt;
      dt = Math.max(0, dt - brk);
    }
    const worked = st + ot + dt;
    const filler = worked > 0 && worked < r.guarantee ? r.guarantee - worked : 0;
    return { st, ot, dt, worked, filler, fillerKind: first };
  }
  function payShift(s) {
    const r = db.rates;
    const rate = r.base + num(s.diff);
    const sp = splitShift(s);
    const mult = { st: 1, ot: r.otMult, dt: r.dtMult };
    const lines = [
      ["Straight time", sp.st, rate],
      ["Overtime x" + r.otMult, sp.ot, rate * r.otMult],
      ["Double time x" + r.dtMult, sp.dt, rate * r.dtMult],
    ];
    if (sp.filler) lines.push(["Guarantee (" + r.guarantee + " hr min)", sp.filler, rate * mult[sp.fillerKind]]);
    const total = lines.reduce((t, l) => t + l[1] * l[2], 0);
    return { sp, rate, lines, total, paidHrs: sp.worked + sp.filler };
  }
  function weeks() {
    const map = {};
    db.shifts.forEach((s) => {
      const k = weekStartOf(s.date);
      (map[k] = map[k] || []).push(s);
    });
    return Object.keys(map).sort().reverse().map((k) => {
      const list = map[k].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      const t = { st: 0, ot: 0, dt: 0, filler: 0, gross: 0 };
      list.forEach((s) => {
        const p = payShift(s);
        t.st += p.sp.st; t.ot += p.sp.ot; t.dt += p.sp.dt; t.filler += p.sp.filler; t.gross += p.total;
      });
      return { key: k, shifts: list, t, stub: db.stubs[k] };
    });
  }
  function verdictFor(w) {
    if (!w.stub || w.stub.gross === "" || w.stub.gross == null) return { cls: "", text: "No stub entered" };
    const diff = num(w.stub.gross) - w.t.gross;
    if (Math.abs(diff) <= db.rates.tolerance) return { cls: "ok", text: "Matches", diff };
    if (diff < 0) return { cls: "bad", text: "Short " + money(-diff), diff };
    return { cls: "warnish", text: "Over " + money(diff), diff };
  }

  // ---------- layout ----------
  const split = $("#split"), L = $("#listPane"), D = $("#detailPane");
  const wide = () => window.matchMedia("(min-width: 700px)").matches;

  function setTab(t) {
    ui.tab = t; ui.sel = null; saveUI();
    split.dataset.mode = "list";
    render();
    window.scrollTo({ top: 0 });
  }
  function select(id) {
    ui.sel = id; saveUI();
    split.dataset.mode = "detail";
    render();
    if (!wide()) window.scrollTo({ top: 0 });
  }
  function back() { ui.sel = null; saveUI(); split.dataset.mode = "list"; render(); }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  window.addEventListener("resize", () => { if (wide() && split.dataset.mode === "detail") render(); });

  const backBtn = () => '<button class="btn ghost small back" data-act="back">&larr; Back</button>';

  function render() {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));
    const soon = db.certs.filter((c) => daysLeft(c) <= 60).length;
    $("#cardsDot").hidden = !soon;
    ({ shifts: rShifts, pay: rPay, royalty: rRoyalty, cards: rCards, rates: rRates, get: rGet })[ui.tab]();
  }

  // ---------- SHIFTS ----------
  function rShifts() {
    const ws = weeks();
    const thisWeek = ws.find((w) => w.key === weekStartOf(today()));
    const cy = contractYearStart();
    const cyHrs = db.shifts.filter((s) => parseDate(s.date) >= cy).reduce((t, s) => t + payShift(s).paidHrs, 0);
    let h = '<div class="row"><h2>Shift log</h2><span class="spacer"></span><button class="btn" data-act="new">+ Log shift</button></div>';
    h += '<div class="stats">' +
      stat(thisWeek ? hrs(thisWeek.t.st + thisWeek.t.ot + thisWeek.t.dt + thisWeek.t.filler) : "0", "hrs this week") +
      stat(money(thisWeek ? thisWeek.t.gross : 0), "owed this week") +
      stat(hrs(cyHrs), "hrs contract yr") + "</div>";
    if (!db.shifts.length) {
      h += '<div class="empty"><p>No shifts yet. Log today\'s, or load a sample week to see how the pay check works.</p>' +
        '<button class="btn ghost" data-act="sample">Load sample week</button></div>';
    }
    ws.forEach((w) => {
      h += '<div class="group"><span>Week of ' + weekLabel(w.key) + '</span><span>' + money(w.t.gross) + "</span></div>";
      w.shifts.slice().reverse().forEach((s) => {
        const p = payShift(s);
        const parts = [];
        if (p.sp.st) parts.push(hrs(p.sp.st) + " ST");
        if (p.sp.ot) parts.push(hrs(p.sp.ot) + " OT");
        if (p.sp.dt) parts.push(hrs(p.sp.dt) + " DT");
        if (p.sp.filler) parts.push("+" + hrs(p.sp.filler) + " guar");
        h += '<button class="item' + (ui.sel === s.id ? " sel" : "") + '" data-sel="' + s.id + '">' +
          '<span class="t">' + fmtDay(s.date) + " &middot; " + esc(s.terminal || "Terminal") + "</span>" +
          '<span class="v">' + money(p.total) + "<small>" + esc(s.start) + "-" + esc(s.end) + "</small></span>" +
          '<span class="s">' + esc([s.vessel, s.gang, s.job].filter(Boolean).join(" / ") || "-") + " &middot; " + parts.join(", ") + "</span></button>";
      });
    });
    L.innerHTML = h;

    const s = db.shifts.find((x) => x.id === ui.sel);
    if (ui.sel === "new" || s) D.innerHTML = shiftForm(s);
    else D.innerHTML = wide() ? '<div class="empty" style="margin-top:40px"><p><b>Pick a shift</b> to see the pay breakdown, or log a new one.</p><p class="hint">On iPhone Duo, unfold for the log and the breakdown side by side.</p></div>' : "";
    if (ui.sel === "new" || s) liveTicket();
  }
  function stat(v, k) { return '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>"; }

  function lastShift() { return db.shifts.slice().sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))[0]; }

  function shiftForm(s) {
    const prev = lastShift() || {};
    const v = s || { date: today(), start: prev.start || "08:00", end: prev.end || "17:00", terminal: prev.terminal || "", vessel: "", gang: prev.gang || "", job: prev.job || "", diff: prev.diff || 0, breakHrs: prev.breakHrs || 0, holiday: false, manual: false, st: 0, ot: 0, dt: 0, notes: "" };
    return backBtn() +
      "<h2>" + (s ? "Edit shift" : "Log shift") + "</h2>" +
      '<form class="form" id="shiftForm" autocomplete="off">' +
      fld("Date", "date", v.date, "date") +
      fld("Terminal / pier", "terminal", v.terminal, "text", "Maher, APM, Port Newark...", "terminals") +
      fld("Start", "start", v.start, "time") +
      fld("End", "end", v.end, "time") +
      fld("Vessel", "vessel", v.vessel, "text", "MSC ...") +
      fld("Gang / header", "gang", v.gang, "text", "Gang 12") +
      fld("Job / skill", "job", v.job, "text", "Lasher, checker, crane...") +
      fld("Skill differential $/hr", "diff", v.diff, "number") +
      fld("Unpaid break (hrs)", "breakHrs", v.breakHrs, "number") +
      '<label class="check full"><input type="checkbox" name="holiday"' + (v.holiday ? " checked" : "") + "> Holiday - pay all hours at double time</label>" +
      '<label class="check full"><input type="checkbox" name="manual"' + (v.manual ? " checked" : "") + "> Enter ST / OT / DT hours myself (port rules differ)</label>" +
      '<div class="full form" id="manualBox"' + (v.manual ? "" : " hidden") + ' style="grid-template-columns:1fr 1fr 1fr">' +
      fld("ST hrs", "st", v.st, "number") + fld("OT hrs", "ot", v.ot, "number") + fld("DT hrs", "dt", v.dt, "number") + "</div>" +
      '<label class="f full">Notes<textarea name="notes" rows="2" placeholder="Ducket #, foreman, anything to prove the shift">' + esc(v.notes) + "</textarea></label>" +
      '<div class="full row wrap"><button class="btn" type="submit">Save shift</button>' +
      (s ? '<button class="btn ghost" type="button" data-act="dup">Same again tomorrow</button><span class="spacer"></span><button class="btn warn" type="button" data-act="del">Delete</button>' : "") +
      "</div></form>" +
      '<datalist id="terminals">' + [...new Set(db.shifts.map((x) => x.terminal).filter(Boolean))].map((t) => '<option value="' + esc(t) + '">').join("") + "</datalist>" +
      '<div id="ticket"></div>';
  }
  function fld(label, name, val, type, ph, list) {
    const step = type === "number" ? ' step="0.25" inputmode="decimal"' : "";
    return '<label class="f">' + label + '<input name="' + name + '" type="' + type + '" value="' + esc(val) + '"' + step +
      (ph ? ' placeholder="' + esc(ph) + '"' : "") + (list ? ' list="' + list + '"' : "") + "></label>";
  }
  function readShiftForm() {
    const f = $("#shiftForm"); if (!f) return null;
    const o = Object.fromEntries(new FormData(f).entries());
    o.holiday = !!f.holiday.checked; o.manual = !!f.manual.checked;
    ["diff", "breakHrs", "st", "ot", "dt"].forEach((k) => (o[k] = num(o[k])));
    return o;
  }
  function ticketHTML(title, lines, total, extra) {
    return '<div class="ticket"><div class="hd"><span>' + title + "</span><span>" + money(total) + "</span></div><table>" +
      lines.filter((l) => l[1]).map((l) => "<tr><td>" + l[0] + '</td><td class="n">' + hrs(l[1]) + " h</td><td>" + money(l[2]) + "/h</td><td>" + money(l[1] * l[2]) + "</td></tr>").join("") +
      '<tr class="total"><td>Gross owed</td><td class="n">' + hrs(lines.reduce((t, l) => t + l[1], 0)) + ' h</td><td></td><td>' + money(total) + "</td></tr></table>" + (extra || "") + "</div>";
  }
  function liveTicket() {
    const o = readShiftForm(); if (!o) return;
    $("#manualBox").hidden = !o.manual;
    const p = payShift(o);
    $("#ticket").innerHTML = ticketHTML("Pay for this shift", p.lines, p.total) +
      '<p class="hint" style="margin-top:8px">Base ' + money(db.rates.base) + "/h + diff " + money(o.diff) + "/h. Straight time window " + db.rates.stStart + "-" + db.rates.stEnd + " Mon-Fri. Change in Rates.</p>";
  }

  // ---------- PAYCHECK ----------
  function rPay() {
    const ws = weeks();
    let short = 0;
    ws.forEach((w) => { const v = verdictFor(w); if (v.cls === "bad") short += -v.diff; });
    let h = "<h2>Paycheck check</h2>";
    h += '<div class="stats">' + stat(ws.length, "weeks logged") + stat(ws.filter((w) => verdictFor(w).cls === "bad").length, "weeks short") + stat(money(short), "owed to you") + "</div>";
    if (!ws.length) h += '<div class="empty"><p>Log shifts first. Each pay week shows up here so you can type in what your stub says.</p></div>';
    ws.forEach((w) => {
      const v = verdictFor(w);
      h += '<button class="item ' + v.cls + (ui.sel === w.key ? " sel" : "") + '" data-sel="' + w.key + '">' +
        '<span class="t">Week of ' + weekLabel(w.key) + "</span>" +
        '<span class="v">' + money(w.t.gross) + "<small>expected</small></span>" +
        '<span class="s">' + w.shifts.length + " shifts &middot; " + v.text + "</span></button>";
    });
    L.innerHTML = h;
    const w = ws.find((x) => x.key === ui.sel);
    if (!w) { D.innerHTML = wide() ? '<div class="empty" style="margin-top:40px"><p><b>Pick a week</b>, then type the gross from your pay stub. HallPay shows the gap and writes the note for your steward.</p></div>' : ""; return; }
    const r = db.rates;
    const lines = [["Straight time", w.t.st, 0], ["Overtime", w.t.ot, 0], ["Double time", w.t.dt, 0], ["Guarantee", w.t.filler, 0]];
    const stub = w.stub || {};
    D.innerHTML = backBtn() + "<h2>Week of " + weekLabel(w.key) + "</h2>" +
      '<div class="ticket"><div class="hd"><span>Expected</span><span>' + money(w.t.gross) + "</span></div><table>" +
      lines.filter((l) => l[1]).map((l) => "<tr><td>" + l[0] + "</td><td>" + hrs(l[1]) + " h</td></tr>").join("") +
      w.shifts.map((s) => "<tr><td>" + fmtDay(s.date) + " " + esc(s.terminal) + "</td><td>" + money(payShift(s).total) + "</td></tr>").join("") +
      "</table></div>" +
      "<h3>What your stub says</h3>" +
      '<form class="form" id="stubForm">' +
      fld("Stub gross $", "gross", stub.gross == null ? "" : stub.gross, "number") +
      fld("Stub hours", "hours", stub.hours == null ? "" : stub.hours, "number") +
      '<div class="full"><button class="btn" type="submit">Check it</button></div></form>' +
      verdictBox(w) +
      '<p class="hint" style="margin-top:10px">Differences under ' + money(r.tolerance) + " are ignored. Expected pay uses your Rates tab.</p>";
  }
  function verdictBox(w) {
    const v = verdictFor(w);
    if (!v.diff && v.cls !== "ok") return '<div class="verdict info">Enter the gross from your stub to check this week.</div>';
    const paidH = w.t.st + w.t.ot + w.t.dt + w.t.filler;
    const hrsNote = w.stub && w.stub.hours !== "" && w.stub.hours != null && Math.abs(num(w.stub.hours) - paidH) > 0.01 ? " Stub shows " + hrs(num(w.stub.hours)) + " h, your log shows " + hrs(paidH) + " h." : "";
    if (v.cls === "ok") return '<div class="verdict ok">Stub matches your log.' + hrsNote + "</div>";
    return '<div class="verdict ' + (v.cls === "bad" ? "bad" : "info") + '">' + v.text + "." + hrsNote + "</div>" +
      (v.cls === "bad" ? '<div class="row wrap" style="margin-top:10px"><button class="btn yellow" data-act="dispute">Copy note for my steward</button></div>' : "");
  }
  function disputeText(w) {
    const v = verdictFor(w);
    return "Pay question - week of " + weekLabel(w.key) + "\n" +
      "Expected gross: " + money(w.t.gross) + "  Stub gross: " + money(num(w.stub.gross)) + "  Short: " + money(-v.diff) + "\n" +
      w.shifts.map((s) => {
        const p = payShift(s);
        return "- " + fmtDay(s.date) + " " + s.start + "-" + s.end + " " + (s.terminal || "") + (s.vessel ? " / " + s.vessel : "") + (s.gang ? " / " + s.gang : "") +
          ": " + hrs(p.sp.st) + " ST, " + hrs(p.sp.ot) + " OT, " + hrs(p.sp.dt) + " DT" + (p.sp.filler ? ", " + hrs(p.sp.filler) + " guarantee" : "") + " = " + money(p.total) + (s.notes ? " (" + s.notes + ")" : "");
      }).join("\n") + "\nRate used: " + money(db.rates.base) + "/h base.";
  }

  // ---------- ROYALTY ----------
  function rRoyalty() {
    const r = db.rates, cy = contractYearStart(), end = new Date(cy.getFullYear() + 1, 8, 30);
    const inYear = db.shifts.filter((s) => parseDate(s.date) >= cy);
    const logged = inYear.reduce((t, s) => t + payShift(s).paidHrs, 0);
    const total = logged + num(r.priorHours);
    const elapsed = Math.max(1, (Date.now() - cy.getTime()) / DAY), span = (end - cy) / DAY + 1;
    const pace = total / elapsed * span;
    const pct = Math.min(100, (total / Math.max(1, r.royaltyMin)) * 100);
    const est = total * num(r.royaltyPerHr);
    L.innerHTML = "<h2>Container royalty</h2>" +
      '<p class="muted">Contract year ' + cy.toLocaleDateString(undefined, { month: "short", year: "numeric" }) + " - " + end.toLocaleDateString(undefined, { month: "short", year: "numeric" }) + ". Royalty is paid on credited hours; the threshold and the $/hr differ by port, so you set them.</p>" +
      '<div class="stats">' + stat(hrs(total), "credited hrs") + stat(hrs(Math.round(pace)), "year-end pace") + stat(r.royaltyPerHr ? money(est) : "-", "est. royalty") + "</div>" +
      '<h3>Toward ' + r.royaltyMin + " hours</h3>" +
      '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<p class="hint" style="margin-top:6px">' + (total >= r.royaltyMin ? "Qualified." : hrs(Math.max(0, r.royaltyMin - total)) + " hours to go. At your pace you finish the year near " + Math.round(pace) + ".") + "</p>" +
      "<h3>Settings</h3>" +
      '<form class="form" id="royForm">' +
      fld("Qualifying hours", "royaltyMin", r.royaltyMin, "number") +
      fld("Est. $ per hour", "royaltyPerHr", r.royaltyPerHr, "number") +
      fld("Hours before HallPay", "priorHours", r.priorHours, "number") +
      '<div class="full"><button class="btn" type="submit">Update</button></div></form>';
    const months = {};
    inYear.forEach((s) => { const k = s.date.slice(0, 7); months[k] = (months[k] || 0) + payShift(s).paidHrs; });
    const keys = Object.keys(months).sort();
    D.innerHTML = wide() ? "<h2>Hours by month</h2>" + (keys.length ? keys.map((k) =>
      '<div class="item" style="cursor:default"><span class="t">' + parseDate(k + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" }) + '</span><span class="v">' + hrs(months[k]) + " h</span></div>").join("")
      : '<div class="empty">No shifts in this contract year yet.</div>') : "";
  }

  // ---------- CARDS ----------
  function daysLeft(c) { return Math.ceil((parseDate(c.expires) - parseDate(today())) / DAY); }
  function rCards() {
    const list = db.certs.slice().sort((a, b) => a.expires.localeCompare(b.expires));
    let h = '<div class="row"><h2>Cards &amp; certs</h2><span class="spacer"></span><button class="btn" data-act="newcard">+ Add</button></div>' +
      '<p class="muted">TWIC, crane, forklift, hazmat, safety. HallPay flags anything inside 60 days.</p>';
    if (!list.length) h += '<div class="empty"><p>No cards yet. Start with your TWIC expiration date.</p></div>';
    list.forEach((c) => {
      const d = daysLeft(c), cls = d < 0 ? "bad" : d <= 60 ? "warnish" : "ok";
      h += '<button class="item ' + cls + (ui.sel === c.id ? " sel" : "") + '" data-sel="' + c.id + '"><span class="t">' + esc(c.name) + '</span><span class="v">' +
        (d < 0 ? "EXPIRED" : d + "d") + "<small>" + esc(c.expires) + '</small></span><span class="s">' + esc(c.number || "") + "</span></button>";
    });
    L.innerHTML = h;
    const c = db.certs.find((x) => x.id === ui.sel);
    if (ui.sel !== "newcard" && !c) { D.innerHTML = wide() ? '<div class="empty" style="margin-top:40px"><p>Pick a card or add one.</p></div>' : ""; return; }
    const v = c || { name: "", number: "", expires: iso(new Date(Date.now() + 365 * DAY)) };
    D.innerHTML = backBtn() + "<h2>" + (c ? "Edit card" : "Add card") + "</h2>" +
      '<form class="form" id="cardForm">' +
      '<label class="f full">Card<input name="name" list="cardNames" value="' + esc(v.name) + '" placeholder="TWIC" required></label>' +
      '<datalist id="cardNames"><option value="TWIC"><option value="Crane operator"><option value="Forklift / hi-lo"><option value="Hazmat"><option value="OSHA 10"><option value="Driver license"><option value="Medical card"></datalist>' +
      fld("Number", "number", v.number, "text") + fld("Expires", "expires", v.expires, "date") +
      '<div class="full row"><button class="btn" type="submit">Save</button><span class="spacer"></span>' + (c ? '<button class="btn warn" type="button" data-act="delcard">Delete</button>' : "") + "</div></form>";
  }

  // ---------- RATES ----------
  function rRates() {
    const r = db.rates;
    L.innerHTML = "<h2>Your rates</h2>" +
      '<p class="muted">Enter the numbers from your local\'s rate sheet. The default $40 base is only an example.</p>' +
      '<form class="form" id="rateForm">' +
      fld("Base $/hr (straight)", "base", r.base, "number") +
      fld("Guarantee hrs / call", "guarantee", r.guarantee, "number") +
      fld("OT multiplier", "otMult", r.otMult, "number") +
      fld("DT multiplier", "dtMult", r.dtMult, "number") +
      fld("Straight time starts", "stStart", r.stStart, "time") +
      fld("Straight time ends", "stEnd", r.stEnd, "time") +
      '<label class="f">Pay week starts<select name="weekStart">' + ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => '<option value="' + i + '"' + (i === r.weekStart ? " selected" : "") + ">" + d + "</option>").join("") + "</select></label>" +
      fld("Ignore stub gaps under $", "tolerance", r.tolerance, "number") +
      '<label class="check full"><input type="checkbox" name="sundayDT"' + (r.sundayDT ? " checked" : "") + "> Sundays pay double time</label>" +
      '<div class="full"><button class="btn" type="submit">Save rates</button></div></form>';
    D.innerHTML = "<h2>Your data</h2>" +
      '<p class="muted">' + db.shifts.length + " shifts, " + db.certs.length + " cards, stored only in this browser. Back it up before you switch phones.</p>" +
      '<div class="row wrap"><button class="btn ghost" data-act="csv">Export CSV</button><button class="btn ghost" data-act="backup">Backup file</button>' +
      '<label class="btn ghost">Restore<input type="file" accept="application/json" id="restore" hidden></label></div>' +
      "<h3>Install</h3><p class=\"muted\">iPhone: Share &rarr; Add to Home Screen. Android: menu &rarr; Install app. Works with no signal on the pier.</p>" +
      '<h3>Danger</h3><button class="btn warn" data-act="wipe">Erase everything</button>';
  }

  // ---------- GET (sales) ----------
  function rGet() {
    L.innerHTML = '<div class="hero"><h2>Know your check is <span class="hi">right</span> before you leave the hall.</h2>' +
      "<p>Log the shift in 10 seconds. HallPay splits straight, overtime and double time, adds the guarantee, and tells you when the stub comes up short &mdash; with the note for your steward already written.</p></div>" +
      '<div class="plans">' +
      plan("Monthly", CFG.PRICE_MONTH || "$4.99", "per month", false) +
      plan("Yearly", CFG.PRICE_YEAR || "$39", "per year &middot; 2 months free", true) +
      plan("Gang / local", (CFG.CREW_PRICE || "$99/yr").split(" ")[0], esc((CFG.CREW_PRICE || "").split(" ").slice(1).join(" ") || "for the whole gang"), false) + "</div>" +
      '<ul class="ticks"><li>Shift log with terminal, vessel, gang, skill differential</li><li>Paycheck check every week, short pay flagged</li><li>Container royalty hours and year-end pace</li><li>TWIC and cert expiration alerts</li><li>Works offline, data stays on your phone, CSV export</li><li>iPhone Duo app (unfolded: log and pay side by side) &mdash; included when it ships</li></ul>' +
      '<div class="row wrap"><button class="btn yellow" data-act="start">Start</button><button class="btn ghost" data-tab-go="shifts">Try it free first</button></div>' +
      '<p class="hint" style="margin-top:10px">Free while you try it. Paying gets you the founding price for life and a say in what ships next.</p>';
    if (ui.sel === "start") D.innerHTML = requestForm();
    else D.innerHTML = wide() ? '<div class="empty" style="margin-top:40px"><p>Built for ILA and ILWU members, checkers, clerks and lashers. Not affiliated with any union or employer group.</p></div>' : "";
  }
  function plan(k, price, sub, best) {
    return '<div class="plan' + (best ? " best" : "") + '"><div class="k">' + k + "</div><b>" + esc(price) + '</b><div class="hint">' + sub + "</div></div>";
  }
  function requestForm() {
    return backBtn() + "<h2>Request access</h2>" +
      '<p class="muted">Leave your info and you\'ll get a payment link and setup help, usually the same day.</p>' +
      '<form class="form" id="reqForm">' +
      '<label class="f full">Name<input name="name" required></label>' +
      fld("Local #", "local", "", "text", "ILA 1235") + fld("Port", "port", "", "text", "Newark") +
      '<label class="f full">Your phone or email<input name="reach" required></label>' +
      '<label class="f full">Plan<select name="plan"><option>Yearly ' + esc(CFG.PRICE_YEAR || "$39") + "</option><option>Monthly " + esc(CFG.PRICE_MONTH || "$4.99") + "</option><option>Gang / local " + esc(CFG.CREW_PRICE || "") + "</option></select></label>" +
      '<div class="full"><button class="btn yellow" type="submit">Send request</button></div></form><div id="reqOut"></div>';
  }
  function sendRequest(f) {
    const o = Object.fromEntries(new FormData(f).entries());
    const body = "HallPay access request\nName: " + o.name + "\nLocal: " + o.local + "\nPort: " + o.port + "\nReach me: " + o.reach + "\nPlan: " + o.plan;
    const c = (CFG.CONTACT || "").trim();
    if (c.includes("@")) location.href = "mailto:" + c + "?subject=" + encodeURIComponent("HallPay - " + o.plan) + "&body=" + encodeURIComponent(body);
    else if (c.replace(/[^\d+]/g, "").length >= 7) location.href = "sms:" + c.replace(/[^\d+]/g, "") + "&body=" + encodeURIComponent(body);
    else {
      copy(body);
      $("#reqOut").innerHTML = '<div class="verdict info">Request copied. Signups open shortly &mdash; paste it to whoever shared HallPay with you.</div>';
    }
  }

  // ---------- actions ----------
  function copy(t) {
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => prompt("Copy this:", t));
    else prompt("Copy this:", t);
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function sample() {
    const ws = parseDate(weekStartOf(today()));
    const d = (n) => iso(new Date(ws.getTime() + n * DAY));
    const base = { terminal: "Port Newark - Pier 51", gang: "Gang 7", job: "Lasher", diff: 0, breakHrs: 1, holiday: false, manual: false, st: 0, ot: 0, dt: 0, notes: "" };
    db.shifts.push(
      Object.assign({}, base, { id: uid(), date: d(0), start: "08:00", end: "17:00", vessel: "MSC Aurora" }),
      Object.assign({}, base, { id: uid(), date: d(1), start: "08:00", end: "20:00", vessel: "MSC Aurora" }),
      Object.assign({}, base, { id: uid(), date: d(2), start: "18:00", end: "21:00", vessel: "Maersk Kinloss", breakHrs: 0 }),
      Object.assign({}, base, { id: uid(), date: d(5), start: "07:00", end: "15:00", vessel: "CMA CGM Tage", job: "Crane", diff: 2.5 })
    );
    db.stubs[iso(ws)] = { gross: 1446.25, hours: 30 };
    db.certs.push({ id: uid(), name: "TWIC", number: "", expires: iso(new Date(Date.now() + 41 * DAY)) });
    save(); render();
  }

  document.addEventListener("click", (e) => {
    const sel = e.target.closest("[data-sel]");
    if (sel) return select(sel.dataset.sel);
    const go = e.target.closest("[data-tab-go]");
    if (go) return setTab(go.dataset.tabGo);
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const act = a.dataset.act;
    if (act === "back") return back();
    if (act === "new") return select("new");
    if (act === "newcard") return select("newcard");
    if (act === "sample") return sample();
    if (act === "start") {
      if (CFG.PAY_URL) return void window.open(CFG.PAY_URL, "_blank", "noopener");
      return select("start");
    }
    if (act === "del" && confirm("Delete this shift?")) { db.shifts = db.shifts.filter((s) => s.id !== ui.sel); save(); return back(); }
    if (act === "dup") {
      const s = db.shifts.find((x) => x.id === ui.sel);
      const n = Object.assign({}, s, { id: uid(), date: iso(new Date(parseDate(s.date).getTime() + DAY)), notes: "" });
      db.shifts.push(n); save(); return select(n.id);
    }
    if (act === "delcard" && confirm("Delete this card?")) { db.certs = db.certs.filter((c) => c.id !== ui.sel); save(); return back(); }
    if (act === "dispute") { const w = weeks().find((x) => x.key === ui.sel); copy(disputeText(w)); a.textContent = "Copied"; return; }
    if (act === "csv") {
      const rows = [["date", "start", "end", "terminal", "vessel", "gang", "job", "st", "ot", "dt", "guarantee", "gross", "notes"]];
      db.shifts.slice().sort((x, y) => x.date.localeCompare(y.date)).forEach((s) => {
        const p = payShift(s);
        rows.push([s.date, s.start, s.end, s.terminal, s.vessel, s.gang, s.job, p.sp.st, p.sp.ot, p.sp.dt, p.sp.filler, p.total.toFixed(2), s.notes]);
      });
      return download("hallpay-shifts.csv", rows.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n"), "text/csv");
    }
    if (act === "backup") return download("hallpay-backup.json", JSON.stringify(db, null, 2), "application/json");
    if (act === "wipe" && confirm("Erase all shifts, stubs and cards on this device?")) {
      db.shifts = []; db.stubs = {}; db.certs = []; save(); return render();
    }
  });

  document.addEventListener("input", (e) => { if (e.target.closest("#shiftForm")) liveTicket(); });
  document.addEventListener("change", (e) => {
    if (e.target.closest("#shiftForm")) liveTicket();
    if (e.target.id === "restore" && e.target.files[0]) {
      e.target.files[0].text().then((t) => {
        try {
          const o = JSON.parse(t);
          db.shifts = o.shifts || []; db.stubs = o.stubs || {}; db.certs = o.certs || []; db.rates = Object.assign({}, DEFAULT_RATES, o.rates);
          save(); render(); alert("Restored " + db.shifts.length + " shifts.");
        } catch (err) { alert("That file is not a HallPay backup."); }
      });
    }
  });

  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "shiftForm") {
      const o = readShiftForm();
      if (ui.sel && ui.sel !== "new") { const i = db.shifts.findIndex((s) => s.id === ui.sel); o.id = ui.sel; db.shifts[i] = o; }
      else { o.id = uid(); db.shifts.push(o); }
      save(); return select(o.id);
    }
    if (f.id === "stubForm") {
      const o = Object.fromEntries(new FormData(f).entries());
      db.stubs[ui.sel] = { gross: o.gross === "" ? "" : num(o.gross), hours: o.hours === "" ? "" : num(o.hours) };
      save(); return render();
    }
    if (f.id === "cardForm") {
      const o = Object.fromEntries(new FormData(f).entries());
      if (ui.sel && ui.sel !== "newcard") { const i = db.certs.findIndex((c) => c.id === ui.sel); o.id = ui.sel; db.certs[i] = o; }
      else { o.id = uid(); db.certs.push(o); }
      save(); return select(o.id);
    }
    if (f.id === "rateForm" || f.id === "royForm") {
      const o = Object.fromEntries(new FormData(f).entries());
      Object.keys(o).forEach((k) => { db.rates[k] = /^(stStart|stEnd)$/.test(k) ? o[k] : num(o[k], DEFAULT_RATES[k]); });
      if (f.id === "rateForm") db.rates.sundayDT = !!f.sundayDT.checked;
      save(); render();
      if (f.id === "rateForm") { const b = $("#rateForm button[type=submit]"); if (b) b.textContent = "Saved"; }
      return;
    }
    if (f.id === "reqForm") return sendRequest(f);
  });

  // keep the selection valid after restores / deletes, then draw
  if (ui.sel) split.dataset.mode = "detail";
  render();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
