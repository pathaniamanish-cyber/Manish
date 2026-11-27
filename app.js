/* Manish Expense & Income Manager: app UI and logic. */
(function () {
  "use strict";
  const C = self.APP_CONFIG, P = self.Parser, ST = self.Stores, R = self.Rates;
  const TABS = C.expenseTabs, SRCS = C.incomeSources, RC = C.reportCurrency;
  const PFX = C.storagePrefix;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store_ = (o, k) => ({ get(d) { try { const v = o.getItem(PFX + "-" + k); return v === null ? d : v; } catch (e) { return d; } }, set(v) { try { o.setItem(PFX + "-" + k, v); } catch (e) {} }, del() { try { o.removeItem(PFX + "-" + k); } catch (e) {} } });
  const LS = k => store_(localStorage, k), SS = k => store_(sessionStorage, k);
  const today = () => P.iso(new Date());
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isApple = /iPhone|iPad|Macintosh|Mac OS X/.test(navigator.userAgent);
  const isStandalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));

  const S = {
    store: null, mode: LS("mode").get(""), ready: false, connected: false, busy: false,
    expenses: [], income: [], settings: { speechLang: C.speechLang },
    view: "home", period: "month", q: "", incomeSource: null, online: navigator.onLine, installEvt: null, error: "",
  };
  let D = null;

  /* ---------- money ---------- */
  const num2 = v => v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (minor, cur) => `${cur} ${num2((minor || 0) / 100)}`;
  const cadOf = r => (typeof r.cadMinor === "number" && !isNaN(r.cadMinor) ? r.cadMinor : (r.currency === RC ? r.amountMinor : null));
  function sumCAD(rows) { let minor = 0, pending = 0; rows.forEach(r => { const c = cadOf(r); if (c === null) pending++; else minor += c; }); return { minor, pending }; }
  function breakdown(rows) {
    const m = {}; rows.forEach(r => { m[r.currency] = (m[r.currency] || 0) + r.amountMinor; });
    return Object.keys(m).sort().map(c => money(m[c], c)).join(" · ");
  }
  const cadText = rows => { const s = sumCAD(rows); return money(s.minor, RC) + (s.pending ? " *" : ""); };

  /* ---------- helpers ---------- */
  function shortDate(iso) { const [y, m, d] = iso.split("-").map(Number); return { d, m: MONTHS[m - 1], y }; }
  function longDate(iso) { if (!iso) return ""; const x = shortDate(iso); return `${x.d} ${x.m} ${x.y}`; }
  function periodRange(p) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth(), iso = P.iso;
    if (p === "today") return [today(), today()];
    if (p === "month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    if (p === "lastmonth") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (p === "year") return [`${y}-01-01`, `${y}-12-31`];
    if (p.startsWith("ym:")) { const [yy, mm] = p.slice(3).split("-").map(Number); return [iso(new Date(yy, mm - 1, 1)), iso(new Date(yy, mm, 0))]; }
    if (p.startsWith("r:")) { const [a, b] = p.slice(2).split("|"); return [a || "0000-01-01", b || "9999-12-31"]; }
    return ["0000-01-01", "9999-12-31"];
  }
  function periodLabel(p) {
    if (p.startsWith("ym:")) { const [y, m] = p.slice(3).split("-"); return `${MONTHS[+m - 1]} ${y}`; }
    if (p.startsWith("r:")) { const [a, b] = p.slice(2).split("|"); return `${longDate(a)} – ${longDate(b)}`; }
    return { today: "Today", month: "This month", lastmonth: "Last month", year: "This year", all: "All time" }[p] || p;
  }
  const inRange = (d, [a, b]) => d >= a && d <= b;
  const tabById = id => TABS.find(t => t.id === id);
  const srcById = id => SRCS.find(s => s.id === id);
  const srcName = r => (srcById(r.sourceId) || {}).name || r.sourceName || "Unknown";
  const sortRows = rows => rows.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const pendingRows = () => [...S.expenses.map(r => ["expense", r]), ...S.income.map(r => ["income", r])].filter(([, r]) => cadOf(r) === null);
  function toast(msg, kind) {
    const el = document.createElement("div"); el.className = "tm " + (kind || ""); el.textContent = msg;
    const tb = $("#toast"); while (tb.children.length >= 2) tb.firstChild.remove(); tb.appendChild(el); setTimeout(() => el.remove(), kind === "bad" ? 7000 : 3200);
  }
  function confirmDialog(title, text, okLabel, danger, cancelLabel) {
    return new Promise(res => {
      const box = $("#dialog .dialog");
      box.innerHTML = `<h3>${esc(title)}</h3><div class="note" style="font-size:16px">${esc(text)}</div>
        <div class="btns"><button data-r="0" class="btn-ghost">${esc(cancelLabel || "Go back")}</button><button data-r="1" class="${danger ? "btn-bad" : "btn-pri"}">${esc(okLabel)}</button></div>`;
      $("#dialog").hidden = false; box.querySelector('[data-r="1"]').focus();
      box.onclick = e => { const b = e.target.closest("[data-r]"); if (!b) return; $("#dialog").hidden = true; box.onclick = null; res(b.dataset.r === "1"); };
    });
  }
  function textDialog(title, hint) {
    return new Promise(res => {
      const box = $("#dialog .dialog");
      box.innerHTML = `<h3>${esc(title)}</h3><div class="note">${esc(hint)}</div>
        <textarea id="dictBox" rows="3" style="margin-top:10px;font-size:18px" placeholder="e.g. Spent 250 US dollars on client travel today"></textarea>
        <div class="btns"><button data-r="0" class="btn-ghost">Cancel</button><button data-r="1" class="btn-pri">Use this</button></div>`;
      $("#dialog").hidden = false; setTimeout(() => $("#dictBox").focus(), 50);
      box.onclick = e => { const b = e.target.closest("[data-r]"); if (!b) return; const v = $("#dictBox").value.trim(); $("#dialog").hidden = true; box.onclick = null; res(b.dataset.r === "1" && v ? v : null); };
    });
  }
  const isAuthErr = e => e && e.name === "AuthError";

  /* ---------- boot ---------- */
  async function boot() {
    window.addEventListener("online", () => { S.online = true; render(); });
    window.addEventListener("offline", () => { S.online = false; render(); });
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; render(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    let returned = false;
    try { returned = ST.consumeRedirect(); if (returned) { S.mode = "google"; LS("mode").set("google"); } }
    catch (e) { S.error = e.message; S.mode = "google"; LS("mode").set("google"); }
    try {
      if (S.mode === "demo") await useDemo(false);
      else if (S.mode === "google") {
        makeGoogle();
        if (S.store.hasToken()) { await S.store.init(); S.connected = true; await loadAll(); if (returned) toast("Connected to your private Google Sheet ✓", "ok"); }
      }
    } catch (e) { S.error = e.message; if (isAuthErr(e)) S.connected = false; }
    $("#boot").hidden = true; $("#app").hidden = false; render();
    restoreDraft();
  }
  async function useDemo(announce) {
    S.store = ST.LocalStore(); await S.store.init(); S.mode = "demo"; LS("mode").set("demo"); S.connected = true;
    await loadAll(); if (announce) toast("Demo mode: data stays on this device", "ok");
  }
  const clientId = () => C.googleClientId || LS("client-id").get("");
  function makeGoogle() { S.store = ST.GoogleStore(clientId()); S.mode = "google"; }
  function connectGoogle() {
    if (!clientId()) { S.view = "settings"; render(); toast("The Google Client ID hasn't been added yet (Arunesh sets this up).", "bad"); return; }
    if (!S.online) { toast("You're offline. Connect to the internet first.", "bad"); return; }
    LS("mode").set("google"); makeGoogle();
    try { S.store.beginSignIn(); } catch (e) { toast(e.message, "bad"); }
  }
  async function loadAll() {
    const [ex, inc, st] = await Promise.all([S.store.list("expense"), S.store.list("income"), S.store.getSettings()]);
    S.expenses = ex; S.income = inc; S.settings = Object.assign({ speechLang: C.speechLang }, st || {}); S.ready = true;
  }
  async function refresh() {
    if (!S.store || !S.connected) return;
    S.busy = true; render();
    try { await loadAll(); toast("Up to date", "ok"); } catch (e) { handleErr(e); }
    S.busy = false; render();
  }
  function handleErr(e) { if (isAuthErr(e)) { S.connected = false; S.error = e.message; } toast(e.message || String(e), "bad"); }

  /* ---------- render ---------- */
  function render() { renderNav(); renderTop(); renderBanner(); renderView(); }
  function navItem(id, icon, name, color) {
    return `<button class="nav-item ${S.view === id ? "on" : ""}" style="--c:${esc(color)}" data-act="go" data-v="${esc(id)}"><span class="ic">${icon}</span><span>${esc(name)}</span></button>`;
  }
  function renderNav() {
    const narrow = innerWidth < 900;
    $("#nav").innerHTML = `<div class="brand"><img src="icon-192.png" alt="">Manish Manager</div>` +
      navItem("home", "📊", "Overview", "#8b5cf6") + `<div class="nav-sep"></div><div class="nav-h">Expenses</div>` +
      TABS.map(t => navItem(t.id, t.icon, narrow ? t.short : t.name, t.color)).join("") + `<div class="nav-sep"></div>` +
      navItem("income", "💰", "Income", "#10b981") + navItem("settings", "⚙️", "Settings", "#64748b");
  }
  function viewTitle() {
    if (S.view === "home") return "Overview"; if (S.view === "income") return "Income"; if (S.view === "settings") return "Settings";
    const t = tabById(S.view); return t ? t.name : "";
  }
  function renderTop() {
    let pill = "";
    if (S.mode === "demo") pill = `<span class="pill warn">🧪 Demo · this device only</span>`;
    else if (S.mode === "google") pill = S.connected ? `<span class="pill ok">🔒 Google · private</span>` : `<span class="pill bad">🔒 Locked</span>`;
    if (!S.online) pill += ` <span class="pill bad">📴 Offline</span>`;
    $("#top").innerHTML = `<h1>${esc(viewTitle())}</h1>${pill}
      ${S.mode && S.connected ? `<button class="btn-ghost btn-sm" data-act="refresh" ${S.busy ? "disabled" : ""}>${S.busy ? "⏳" : "↻"} Refresh</button>` : ""}`;
  }
  function renderBanner() {
    let h = "";
    if (!S.online && S.mode === "google") h += `<div class="banner bad"><div class="grow">📴 <b>You're offline.</b> Nothing can be saved until you're back online.</div></div>`;
    if (S.mode === "google" && !S.connected) h += `<div class="banner info"><div class="grow">🔒 <b>Your data is locked.</b> Sign in to open your private Google Sheet.${S.error ? `<div class="note">${esc(S.error)}</div>` : ""}</div><button class="btn-pri" data-act="connect">Sign in with Google</button></div>`;
    const pend = S.ready ? pendingRows().length : 0;
    if (pend && S.view !== "settings") h += `<div class="banner warn"><div class="grow">💱 <b>${pend} ${pend === 1 ? "entry is" : "entries are"} waiting for an exchange rate.</b> Totals marked * leave them out.</div><button class="btn-sm btn-pri" data-act="fix-rates" ${S.busy || !S.online ? "disabled" : ""}>Get rates now</button></div>`;
    $("#banner").innerHTML = h;
  }
  function renderView() {
    const v = $("#view");
    if (!S.mode) { v.innerHTML = welcomeView(); return; }
    if (S.view === "settings") { v.innerHTML = settingsView(); return; }
    if (!S.ready) { v.innerHTML = `<div class="card empty"><div class="big">🔒</div>Sign in to see your entries.</div>`; return; }
    if (S.view === "home") v.innerHTML = homeView();
    else if (S.view === "income") v.innerHTML = incomeView();
    else v.innerHTML = tabView(tabById(S.view));
  }

  function welcomeView() {
    return `<div class="welcome"><div class="card">
      <h2 style="font-size:24px">👋 Welcome, ${esc(C.ownerName)}</h2>
      <p class="note" style="font-size:16px">Choose where your entries are kept. You can change this later in Settings.</p>
      <button class="choice" data-act="start-google"><span class="big">🔒</span><span><b>Sign in with Google (private)</b><span>Entries go into your own Google Sheet and receipts into a Drive folder you own. The app can only see files it creates.</span></span></button>
      <button class="choice" data-act="start-demo"><span class="big">🧪</span><span><b>Just try it (demo)</b><span>Entries stay on this device only. Good for testing voice and the screens.</span></span></button>
    </div></div>`;
  }
  const statCard = (k, v, s, color) => `<div class="stat" style="--c:${esc(color)}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
  function micBlock(label, sub, act, disabled) {
    return `<div class="actions"><button class="mic" data-act="${act}" aria-label="${esc(label)}" ${disabled ? "disabled" : ""}>🎤</button>
      <div class="mic-label"><b>${esc(label)}</b><span>${esc(sub)}</span><a href="#" class="note" data-act="type-${act}" ${disabled ? "hidden" : ""}>⌨️ Type or dictate instead</a></div><span style="flex:1"></span>
      <button class="btn-pri" data-act="${act === "mic-income" ? "add-income" : "add-expense"}" ${disabled ? "disabled" : ""}>＋ Add manually</button></div>`;
  }
  function periodChips(color) {
    const ps = ["month", "lastmonth", "year", "all"];
    const ym = S.period.startsWith("ym:") ? S.period.slice(3) : "";
    const [ra, rb] = S.period.startsWith("r:") ? S.period.slice(2).split("|") : ["", ""];
    return `<div class="filters" style="--c:${color}">
      ${ps.map(p => `<button class="chip ${S.period === p ? "on" : ""}" data-act="period" data-v="${p}">${periodLabel(p)}</button>`).join("")}
      <input type="month" aria-label="Pick a month" data-f="month" value="${esc(ym)}" class="${ym ? "chip on" : ""}">
      <span class="range"><input type="date" aria-label="From date" data-f="from" value="${esc(ra)}"><span class="note">to</span><input type="date" aria-label="To date" data-f="to" value="${esc(rb)}"></span>
    </div>`;
  }
  function filterRows(rows) {
    const rg = periodRange(S.period), q = S.q.trim().toLowerCase();
    return sortRows(rows.filter(r => inRange(r.date, rg) && (!q || [r.description, r.payer, r.service, r.notes, r.currency, (r.amountMinor / 100).toString(), r.receiptName].join(" ").toLowerCase().includes(q))));
  }

  function homeView() {
    const rg = periodRange(S.period);
    const ex = S.expenses.filter(r => inRange(r.date, rg)), inc = S.income.filter(r => inRange(r.date, rg));
    const perTab = TABS.map(t => ({ t, rows: ex.filter(r => r.tabId === t.id) })).map(x => Object.assign(x, { s: sumCAD(x.rows) }));
    const perSrc = SRCS.map(s => ({ s, rows: inc.filter(r => r.sourceId === s.id) })).map(x => Object.assign(x, { v: sumCAD(x.rows) }));
    const maxT = Math.max(1, ...perTab.map(x => x.s.minor)), maxS = Math.max(1, ...perSrc.map(x => x.v.minor));
    const latest = sortRows([...S.expenses.map(r => Object.assign({ _k: "expense" }, r)), ...S.income.map(r => Object.assign({ _k: "income" }, r))]).slice(0, 8);
    const exS = sumCAD(ex), inS = sumCAD(inc);
    return `${periodChips("#8b5cf6")}
      <div class="grid g4">
        ${statCard(`Expenses · ${periodLabel(S.period)}`, cadText(ex), `${ex.length} entries${exS.pending ? ` · ${exS.pending} rate pending` : ""}`, "#ec4899")}
        ${statCard(`Income · ${periodLabel(S.period)}`, cadText(inc), `${inc.length} entries${inS.pending ? ` · ${inS.pending} rate pending` : ""}`, "#10b981")}
        ${statCard("Expenses · all time", cadText(S.expenses), `${S.expenses.length} entries`, "#6366f1")}
        ${statCard("Income · all time", cadText(S.income), `${S.income.length} entries`, "#f59e0b")}
      </div>
      <p class="note">All totals are shown in ${RC}, converted with the rate saved on each entry. They're tracker totals, not a bank balance. * means some entries are still waiting for a rate.</p>
      <div class="grid g2">
        <div class="card"><h2>Expenses by tab</h2>
          ${perTab.map(({ t, rows, s }) => `<div class="bar" style="--c:${t.color}" data-act="go" data-v="${t.id}"><span class="lab">${t.icon} ${esc(t.name)}</span><div class="track"><div class="fill" style="width:${(s.minor / maxT * 100).toFixed(1)}%"></div></div><b>${esc(cadText(rows))}</b></div>`).join("")}
        </div>
        <div class="card"><h2>Income by source</h2>
          ${perSrc.map(({ s, rows, v }) => `<div class="bar" style="--c:${s.color}" data-act="go-src" data-v="${s.id}"><span class="lab">💰 ${esc(s.name)}</span><div class="track"><div class="fill" style="width:${(v.minor / maxS * 100).toFixed(1)}%"></div></div><b>${esc(cadText(rows))}</b></div>`).join("")}
        </div>
      </div>
      <div class="card"><h2>Latest entries</h2>${latest.length ? `<ul class="list">${latest.map(r => itemRow(r, r._k, true)).join("")}</ul>` : `<div class="empty"><div class="big">🌱</div>No entries yet. Open an expense tab or Income to add your first one.</div>`}</div>`;
  }
  function itemRow(r, kind, showWhere) {
    const d = shortDate(r.date || today());
    const where = kind === "expense" ? (() => { const t = tabById(r.tabId) || { name: r.tabName || "?", short: r.tabName, color: "#888", icon: "❔" }; return `<span class="tag" style="--c:${t.color}">${t.icon} ${esc(t.short)}</span>`; })()
      : `<span class="tag" style="--c:${esc((srcById(r.sourceId) || {}).color || "#10b981")}">💰 ${esc(srcName(r))}</span>`;
    const title = kind === "expense" ? r.description : ([r.payer, r.service].filter(Boolean).join(" · ") || "Income");
    const cad = cadOf(r);
    return `<li class="item" data-act="edit" data-k="${kind}" data-id="${esc(r.id)}">
      <div class="dt"><b>${d.d}</b><span>${d.m}${d.y !== new Date().getFullYear() ? " " + String(d.y).slice(2) : ""}</span></div>
      <div class="body"><div class="t">${esc(title || "(no description)")}</div><div class="m">${showWhere ? where : ""}${r.receiptId ? "<span>📎 receipt</span>" : ""}${r.currency !== RC ? `<span>${cad === null ? "💱 rate pending" : "≈ " + esc(money(cad, RC))}</span>` : ""}</div></div>
      <div class="amt ${kind === "income" ? "inc" : ""}">${kind === "income" ? "+" : ""}${esc(money(r.amountMinor, r.currency))}</div></li>`;
  }
  function listCard(rows, kind, color, showWhere, csvAttrs, emptyText) {
    const shown = filterRows(rows);
    return `<div class="card">${periodChips(color)}
        <div class="filters"><input type="search" placeholder="🔍 Search" aria-label="Search" data-f="q" value="${esc(S.q)}"></div>
        <div class="sum"><span>${shown.length} entries · ${esc(periodLabel(S.period))}${shown.length ? ` · ${esc(breakdown(shown))}` : ""}</span><b>${esc(cadText(shown))}</b></div>
        ${shown.length ? `<ul class="list">${shown.map(r => itemRow(r, kind, showWhere)).join("")}</ul>` : `<div class="empty">${esc(emptyText)}</div>`}
        <div class="actions" style="margin-top:12px"><button class="btn-ghost btn-sm" data-act="csv" data-k="${kind}" ${csvAttrs}>⬇ Export these to CSV</button></div></div>`;
  }
  function tabView(t) {
    const rows = S.expenses.filter(r => r.tabId === t.id), td = today(), mr = periodRange("month"), yr = periodRange("year");
    return `<div class="hero" style="--c:${t.color}">
        <div class="hero-top"><div class="hero-ic">${t.icon}</div><div><h2>${esc(t.name)}</h2><div class="note" style="color:#fffc">${esc(t.note)} · expenses only · usual currency ${t.defaultCurrency}</div></div></div>
        <div class="nums">
          <div class="n"><span>Today</span><b>${esc(cadText(rows.filter(r => r.date === td)))}</b></div>
          <div class="n"><span>This month</span><b>${esc(cadText(rows.filter(r => inRange(r.date, mr))))}</b></div>
          <div class="n"><span>This year</span><b>${esc(cadText(rows.filter(r => inRange(r.date, yr))))}</b></div>
          <div class="n"><span>All time</span><b>${esc(cadText(rows))}</b></div>
        </div></div>
      <div class="card">${micBlock("Tap to speak", "e.g. “Spent 250 US dollars on client travel yesterday”", "mic-tab")}</div>
      ${listCard(rows, "expense", t.color, false, `data-tab="${t.id}"`, `No ${t.name} expenses for ${periodLabel(S.period).toLowerCase()}.`)}`;
  }
  function incomeView() {
    const sel = S.incomeSource ? srcById(S.incomeSource) : null;
    const mr = periodRange("month");
    const rows = S.income.filter(r => !sel || r.sourceId === sel.id);
    const c = sel ? sel.color : "#10b981";
    return `<div class="card"><h2>1 · Choose the income source</h2>
        <div class="sources">${SRCS.map(s => `<button class="src ${S.incomeSource === s.id ? "on" : ""}" style="--c:${s.color}" data-act="pick-src" data-v="${s.id}">${esc(s.name)}<small>${esc(cadText(S.income.filter(r => r.sourceId === s.id && inRange(r.date, mr))))} this month</small></button>`).join("")}</div>
        ${sel ? `<button class="btn-ghost btn-sm" data-act="pick-src" data-v="">Show all sources</button>` : ""}</div>
      <div class="hero" style="--c:${esc(c)}"><div class="hero-top"><div class="hero-ic">💰</div><div><h2>${esc(sel ? sel.name : "All income")}</h2>${sel && sel.needsDetail ? `<div class="note" style="color:#fffc">Every entry needs a short description of the client, service or deal.</div>` : ""}</div></div>
        <div class="nums"><div class="n"><span>This month</span><b>${esc(cadText(rows.filter(r => inRange(r.date, mr))))}</b></div>
        <div class="n"><span>This year</span><b>${esc(cadText(rows.filter(r => inRange(r.date, periodRange("year")))))}</b></div>
        <div class="n"><span>All time</span><b>${esc(cadText(rows))}</b></div></div></div>
      <div class="card"><h2>2 · Record income</h2>${micBlock(sel ? "Tap to speak" : "Choose a source above first", "e.g. “Received 5,000 Canadian dollars from ABC for consulting”", "mic-income", !sel)}</div>
      ${listCard(rows, "income", c, !sel, `data-src="${esc(sel ? sel.id : "")}"`, `No income for ${periodLabel(S.period).toLowerCase()}.`)}`;
  }

  function settingsView() {
    const info = S.store ? S.store.info() : {};
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let topLevel; try { topLevel = window.top === window.self; } catch (e) { topLevel = false; }
    const chk = (n, ok) => `<div class="c"><span>${esc(n)}</span><span class="pill ${ok ? "ok" : "bad"}">${ok ? "OK" : "No"}</span></div>`;
    return `
      <div class="card"><h2>🔐 Where your data is kept</h2>
        <div class="set-row"><div class="grow"><b>${esc(info.label || "Not chosen yet")}</b>
          ${S.mode === "demo" ? `<div class="note">Entries stay only in this browser on this device. Export a CSV before switching.</div>` : ""}
          ${S.mode === "google" && info.sheetUrl ? `<div class="note"><a href="${esc(info.sheetUrl)}" target="_blank" rel="noopener">Open my private Google Sheet ↗</a></div>` : ""}</div>
          ${S.mode !== "demo" ? `<button class="btn-ghost btn-sm" data-act="start-demo">Use demo mode</button>` : ""}</div>
        <div class="actions" style="margin-top:10px">
          <button class="btn-ok" data-act="connect">${S.mode === "google" && S.connected ? "Reconnect Google" : "Sign in with Google"}</button>
          ${S.mode === "google" && S.connected ? `<button class="btn-ghost" data-act="signout">Sign out</button>` : ""}
        </div>
        <p class="note">Google permission requested: <b>drive.file</b> only. The app can only see the Sheet and receipts folder it creates in <b>your</b> Drive. It can't see the rest of your Drive or your email. The developer never receives your password or your data.</p>
        ${!C.googleClientId ? `<details><summary class="note">Developer setup (Arunesh)</summary>
          <label for="cid">Google OAuth Client ID</label><input id="cid" data-f="cid" value="${esc(clientId())}" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false">
          <div class="actions" style="margin-top:8px"><button class="btn-pri btn-sm" data-act="save-cid">Save ID on this device</button></div>
          <p class="note">Authorized JavaScript origin: <b>${esc(location.origin)}</b><br>Authorized redirect URI: <b>${esc(ST.redirectUri())}</b></p></details>` : ""}
      </div>
      <div class="card"><h2>💱 Currency rules</h2>
        <p class="note">Each entry keeps its original amount and currency (CAD, USD, INR, GBP or EUR). For reports it's converted to <b>${RC}</b> at the <b>reference rate for the entry's own date</b> (or the closest earlier published day) from ${esc(C.rateSourceLabel)}. The rate, its date and its source are saved with the entry and never change unless you edit the entry's currency or date. If the rate service is down, the entry is saved with <b>rate pending</b> and left out of ${RC} totals (marked *) until you tap “Get rates now”.</p>
        <div class="actions"><button class="btn-pri btn-sm" data-act="fix-rates" ${S.ready && pendingRows().length && S.online ? "" : "disabled"}>Get missing rates (${S.ready ? pendingRows().length : 0})</button></div>
      </div>
      <div class="card"><h2>🎤 Voice</h2>
        <label for="lang">Speech language</label>
        <select id="lang" data-f="lang">${[["en-CA", "English (Canada)"], ["en-US", "English (US)"], ["en-IN", "English (India)"], ["hi-IN", "Hindi"]].map(([v, n]) => `<option value="${v}" ${S.settings.speechLang === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <div class="checks" style="margin-top:10px">${chk("Secure HTTPS page", window.isSecureContext)}${chk("Running as its own page", topLevel)}${chk("Speech recognition available", !!SR)}${chk("Microphone available", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia))}</div>
        <p class="note">Voice uses your browser's built-in speech recognition. It's free; on Apple devices Siri/Dictation must be turned on. The app never records or stores audio. If voice doesn't work, use “⌨️ Type or dictate instead”: the keyboard's own 🎤 key works there.</p>
      </div>
      <div class="card"><h2>📦 Backup &amp; export</h2>
        <div class="actions">
          <button class="btn-pri" data-act="csv" data-k="expense" ${S.ready ? "" : "disabled"}>⬇ All expenses CSV</button>
          <button class="btn-pri" data-act="csv" data-k="income" ${S.ready ? "" : "disabled"}>⬇ All income CSV</button>
          <button class="btn-ghost" data-act="import" ${S.ready ? "" : "disabled"}>⬆ Restore from CSV</button>
        </div>
        <p class="note">CSV files include the original amount, currency, ${RC} equivalent, rate, rate date and receipt link. Restoring skips rows that already exist.</p>
        <input type="file" id="importFile" accept=".csv,text/csv" hidden>
      </div>
      <div class="card"><h2>📲 Install</h2>
        ${S.installEvt ? `<button class="btn-ok" data-act="install">Install app</button>` : ""}
        <p class="note"><b>MacBook (Safari, macOS Sonoma or later):</b> File → Add to Dock.<br><b>iPhone (Safari):</b> Share button → Add to Home Screen.</p>
        <p class="note">Version ${esc(C.version)} · private · no paid services.</p>
      </div>`;
  }

  /* ---------- voice ---------- */
  function srHelp(code) {
    const mac = /Macintosh/.test(navigator.userAgent) && !("ontouchend" in document);
    const H = {
      "not-allowed": mac ? "Microphone or speech recognition is blocked. In Safari: Safari menu → Settings → Websites → Microphone → set this site to Allow. Also check System Settings → Privacy & Security → Microphone and Speech Recognition → Safari." :
        isApple ? "Microphone or speech recognition is blocked. Check Settings → Apps → Safari → Microphone (Allow), and Settings → Privacy & Security → Speech Recognition → Safari." : "Microphone is blocked for this site. Allow it in the browser's site settings and try again.",
      "service-not-allowed": isApple ? "Speech recognition is turned off. Turn on Dictation (Mac: System Settings → Keyboard → Dictation; iPhone: Settings → General → Keyboard → Enable Dictation)" + (isStandalone() ? ", or open the app in Safari instead of the Home Screen icon." : ".") : "The browser's speech service is unavailable.",
      "no-speech": "I didn't hear anything. Tap the mic and start speaking within a few seconds.",
      "audio-capture": "No microphone input. Another app may be using the mic.",
      "network": "Voice needs internet. Check your connection and try again.",
      "language-not-supported": "This language isn't available. Choose English (Canada) in Settings.",
    };
    return H[code] || "Voice didn't work this time.";
  }
  let rec = null, recCancelled = false;
  function listen(onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { textDialog("Voice isn't available here", "Type the entry, or tap the 🎤 key on your keyboard and speak.").then(t => t && onText(t)); return; }
    if (rec) return;
    recCancelled = false;
    const ov = $("#listen");
    ov.innerHTML = `<div class="orb">🎤</div><div class="say" id="lsay">Starting…</div><div class="live" id="llive"></div>
      <div class="actions" style="justify-content:center"><button class="btn-ok" data-act="lstop">✓ Done</button><button class="btn-ghost" data-act="lcancel">Cancel</button></div>
      <div class="hint">Speak naturally and say the currency (e.g. “US dollars”, “Canadian dollars”, “rupees”). Nothing is saved until you check the draft and tap Save.</div>`;
    ov.hidden = false;
    rec = new SR(); rec.lang = S.settings.speechLang || C.speechLang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = "", interim = "", recErr = null;
    rec.onstart = () => { $("#lsay").textContent = "Listening… speak now"; };
    rec.onresult = e => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      $("#llive").innerHTML = `<b>${esc(finalText)}</b> ${esc(interim)}`;
    };
    rec.onerror = e => { if (e.error !== "aborted") recErr = e.error; };
    rec.onend = async () => {
      rec = null; ov.hidden = true;
      if (recCancelled) { toast("Cancelled. Nothing was changed."); return; }
      const text = (finalText || interim).trim();
      if (text) return onText(text);
      if (recErr && recErr !== "no-speech") {
        const go = await confirmDialog(`Voice problem (${recErr})`, srHelp(recErr), "Type or dictate instead", false, "Close");
        if (go) { const t = await textDialog("Type or dictate", "Tap the 🎤 key on your keyboard to dictate, or type."); if (t) onText(t); }
      } else toast(srHelp("no-speech"), "bad");
    };
    try { rec.start(); } catch (err) { rec = null; ov.hidden = true; toast(err.message, "bad"); }
  }
  const typeIn = handler => textDialog("Type or dictate", "Write it the way you'd say it. On iPhone/Mac you can tap the keyboard's 🎤 key to dictate.").then(t => t && handler(t));

  const parseCtx = () => ({ tabs: TABS, now: new Date() });
  function currencyFromSpeech(p, fallback, where, flags) {
    if (p.currency) return p.currency;
    if (p.currencyInfo && p.currencyInfo.ambiguous) { flags.push(["warn", `You said ${p.currencyInfo.how}. Tap the right currency below.`]); return ""; }
    flags.push(["warn", `No currency said, so I used ${fallback} (usual for ${where}). Change it if needed.`]); return fallback;
  }
  function handleSpokenExpense(text, currentTab) {
    const p = P.parseExpense(text, parseCtx());
    if (p.intent === "cancel") return toast("Cancelled");
    if (p.intent === "save" || p.intent === "correct" || p.intent === "unclear") return toast("There's no draft open. Say the expense first.", "bad");
    if (p.intent === "show") return applyShow(p);
    if (p.intent === "income-hint") { toast("That sounds like income. Opening the Income tab: choose a source, then speak."); S.view = "income"; render(); return; }
    const flags = p.flags.slice();
    const tabId = p.tabId || currentTab || null;
    if (p.tabId && currentTab && p.tabId !== currentTab) flags.push(["warn", `You said “${tabById(p.tabId).name}” while on the ${tabById(currentTab).name} tab. I used ${tabById(p.tabId).name}. Check this is right.`]);
    if (!tabId) flags.push(["warn", "Choose which expense tab this belongs to."]);
    const tab = tabById(tabId);
    const currency = currencyFromSpeech(p, tab ? tab.defaultCurrency : RC, tab ? tab.name : "reports", flags);
    openDraft({ kind: "expense", tabId, date: p.date, amount: p.amount, currency, description: p.description, heard: text, flags, method: "voice" });
  }
  function handleSpokenIncome(text) {
    const p = P.parseIncome(text, parseCtx());
    if (p.intent === "cancel") return toast("Cancelled");
    if (p.intent === "save" || p.intent === "correct" || p.intent === "unclear") return toast("There's no draft open. Say the income first.", "bad");
    if (p.intent === "show") return applyShow(Object.assign(p, { kind: "income" }));
    const src = srcById(S.incomeSource), flags = p.flags.slice();
    const currency = currencyFromSpeech(p, src.defaultCurrency, src.name, flags);
    openDraft({ kind: "income", sourceId: S.incomeSource, date: p.date, amount: p.amount, currency, payer: p.payer, service: p.service, heard: text, flags, method: "voice" });
  }
  function applyShow(p) {
    let period = p.period;
    if (period.startsWith("m:")) { const n = new Date(), mi = +period.slice(2); const y = mi > n.getMonth() ? n.getFullYear() - 1 : n.getFullYear(); period = `ym:${y}-${String(mi + 1).padStart(2, "0")}`; }
    S.period = period; S.q = "";
    S.view = p.kind === "income" ? "income" : (p.tabId || "home");
    render();
  }
  function handleSpokenInDraft(text) {
    const p = D.kind === "expense" ? P.parseExpense(text, parseCtx()) : P.parseIncome(text, parseCtx());
    if (p.intent === "cancel") return closeDraft();
    if (p.intent === "save") return saveDraft();
    if (p.intent === "correct") {
      D[p.field] = p.value; D.heard = text;
      D.flags = [["ok", `Changed ${p.field} to ${p.field === "amount" ? p.value : p.value}.`]];
      if (p.field === "currency" || p.field === "date") refreshRate(); return renderSheet();
    }
    if (p.intent !== "expense" && p.intent !== "income") { D.flags = [["warn", "I didn't understand that as a change. Try “Change amount to 275” or “Change currency to US dollars”."]]; D.heard = text; return renderSheet(); }
    if (p.amount != null) D.amount = p.amount;
    if (p.currency) D.currency = p.currency;
    if (D.kind === "expense") { if (p.description) D.description = p.description; if (p.tabId) D.tabId = p.tabId; }
    else { if (p.payer) D.payer = p.payer; if (p.service) D.service = p.service; }
    if (!/assumed today/.test(JSON.stringify(p.flags))) D.date = p.date;
    D.heard = text; D.flags = p.flags.filter(f => !/assumed today/.test(f[1])); refreshRate(); renderSheet();
  }

  /* ---------- draft ---------- */
  function openDraft(o) {
    const ex = o.rec;
    const defCur = o.kind === "expense" ? ((tabById(o.tabId) || {}).defaultCurrency || RC) : ((srcById(o.sourceId) || {}).defaultCurrency || RC);
    D = {
      kind: o.kind, isNew: !ex, id: ex ? ex.id : ST.uid(),
      tabId: ex ? ex.tabId : (o.tabId || null), sourceId: ex ? ex.sourceId : (o.sourceId || null),
      date: ex ? ex.date : (o.date || today()),
      amount: ex ? ex.amountMinor / 100 : (o.amount != null ? o.amount : ""),
      currency: ex ? ex.currency : (o.currency !== undefined ? o.currency : defCur),
      description: ex ? ex.description || "" : (o.description || ""),
      payer: ex ? ex.payer || "" : (o.payer || ""), service: ex ? ex.service || "" : (o.service || ""), notes: ex ? ex.notes || "" : (o.notes || ""),
      receipt: ex && ex.receiptId ? { receiptId: ex.receiptId, receiptName: ex.receiptName, receiptLink: ex.receiptLink } : null,
      receiptHash: ex ? ex.receiptHash || "" : "", oldReceiptId: ex ? ex.receiptId : null,
      pendingFile: null, uploaded: o.uploaded || null, removeReceipt: false,
      rate: ex && ex.rateToCAD != null ? { rate: ex.rateToCAD, rateDate: ex.rateDate, source: ex.rateSource } : null,
      orig: ex ? { currency: ex.currency, date: ex.date, rate: ex.rateToCAD } : null, rateState: "",
      heard: o.heard || "", flags: o.flags || [], method: ex ? ex.entryMethod : (o.method || "manual"),
      createdAt: ex ? ex.createdAt : null, saving: false, progress: 0, error: "", authErr: false, ocr: "",
    };
    renderSheet(); $("#sheet").hidden = false; refreshRate();
  }
  function closeDraft() { D = null; $("#sheet").hidden = true; }
  function rateLineHtml() {
    if (!D || !D.currency) return "";
    if (D.currency === RC) return `<span class="note">Reported as entered (${RC}).</span>`;
    const amt = parseFloat(D.amount);
    if (D.rateState === "loading") return `<span class="note">💱 Getting the ${D.currency}→${RC} rate for ${esc(longDate(D.date))}…</span>`;
    if (D.rate) return `<span class="note">💱 1 ${D.currency} = ${D.rate.rate.toFixed(4)} ${RC} · rate date ${esc(longDate(D.rate.rateDate))} · ${esc(D.rate.source)}${amt > 0 ? ` · <b>≈ ${esc(money(Math.round(amt * 100 * D.rate.rate), RC))}</b>` : ""}</span>`;
    if (D.rateState === "fail") return `<span class="note" style="color:#fde68a">⚠️ Exchange rate unavailable right now. You can still save; ${RC} will show as “rate pending”.</span>`;
    return "";
  }
  function paintRate() { const el = $("#rateLine"); if (el) el.innerHTML = rateLineHtml(); }
  let rateSeq = 0;
  async function refreshRate() {
    if (!D || !D.currency || !/^\d{4}-\d{2}-\d{2}$/.test(D.date || "")) { if (D) { D.rate = null; D.rateState = ""; paintRate(); } return; }
    if (D.currency === RC) { D.rate = { rate: 1, rateDate: D.date, source: "same currency" }; D.rateState = "ok"; paintRate(); return; }
    if (D.orig && D.orig.rate != null && D.orig.currency === D.currency && D.orig.date === D.date) { D.rate = { rate: D.orig.rate, rateDate: D.rate ? D.rate.rateDate : D.date, source: D.rate ? D.rate.source : "" }; if (!D.rate.source) { const ex = (D.kind === "expense" ? S.expenses : S.income).find(r => r.id === D.id); if (ex) D.rate = { rate: ex.rateToCAD, rateDate: ex.rateDate, source: ex.rateSource }; } D.rateState = "ok"; paintRate(); return; }
    const my = ++rateSeq, d = D; d.rate = null; d.rateState = "loading"; paintRate();
    try { const r = await R.toCAD(d.currency, d.date); if (my !== rateSeq || D !== d) return; d.rate = r; d.rateState = "ok"; }
    catch (e) { if (my !== rateSeq || D !== d) return; d.rate = null; d.rateState = "fail"; }
    paintRate();
  }
  function renderSheet() {
    if (!D) return;
    const box = $("#sheet .sheet"), isEx = D.kind === "expense";
    const tab = isEx && tabById(D.tabId), src = !isEx && srcById(D.sourceId);
    const color = isEx ? (tab ? tab.color : "#6366f1") : (src ? src.color : "#10b981");
    const rc = D.pendingFile ? { name: D.pendingFile.name, size: D.pendingFile.size, pending: true, img: /^image\//.test(D.pendingFile.type) } : (D.receipt && !D.removeReceipt ? { name: D.receipt.receiptName } : (D.uploaded ? { name: D.uploaded.receiptName } : null));
    box.style.setProperty("--c", color);
    box.innerHTML = `
      <div class="sheet-head"><h2 id="sheetTitle">${D.isNew ? "New" : "Edit"} ${isEx ? "expense" : "income"}</h2><button class="mic mic-sm" data-act="mic-draft" aria-label="Speak a correction" ${D.saving ? "disabled" : ""}>🎤</button></div>
      ${D.heard ? `<div class="heard">I heard: <b>“${esc(D.heard)}”</b></div>` : ""}
      ${D.flags.map(([k, m]) => `<div class="flag ${k}">${k === "ok" ? "✓" : k === "bad" ? "⛔" : "⚠️"} ${esc(m)}</div>`).join("")}
      <label>${isEx ? "Expense tab" : "Income source"}</label>
      <div class="tabpick">${isEx ? TABS.map(t => `<button class="chip ${D.tabId === t.id ? "on" : ""}" style="--c:${t.color}" data-act="d-tab" data-v="${t.id}">${t.icon} ${esc(t.name)}</button>`).join("")
        : SRCS.map(s => `<button class="chip ${D.sourceId === s.id ? "on" : ""}" style="--c:${s.color}" data-act="d-src" data-v="${s.id}">${esc(s.name)}</button>`).join("")}</div>
      <label>Currency</label>
      <div class="tabpick">${C.currencies.map(c => `<button class="chip ${D.currency === c ? "on" : ""}" data-act="d-cur" data-v="${c}">${c}</button>`).join("")}</div>
      <div class="row2">
        <div><label for="dAmt">Amount${D.currency ? ` (${D.currency})` : ""}</label><input id="dAmt" class="amount-in" data-f="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(D.amount)}" placeholder="0.00"></div>
        <div><label for="dDate">Date</label><input id="dDate" data-f="date" type="date" max="${P.iso(new Date(Date.now() + 864e5))}" value="${esc(D.date)}"></div>
      </div>
      <div id="rateLine" class="rate-line">${rateLineHtml()}</div>
      ${isEx ? `<label for="dDesc">Description</label><input id="dDesc" data-f="description" maxlength="200" value="${esc(D.description)}" placeholder="What was it for?">`
        : `<div class="row2"><div><label for="dPayer">From (client / payer)</label><input id="dPayer" data-f="payer" maxlength="120" value="${esc(D.payer)}"></div>
           <div><label for="dSvc">For (service / reason)${src && src.needsDetail ? " · required" : ""}</label><input id="dSvc" data-f="service" maxlength="160" value="${esc(D.service)}" placeholder="${src && src.needsDetail ? "Client, service or outside deal" : ""}"></div></div>
           <label for="dNotes">Note (optional)</label><input id="dNotes" data-f="notes" maxlength="300" value="${esc(D.notes)}">`}
      <label>${isEx ? "Receipt" : "Invoice / document"} (optional · PDF or photo · max ${C.maxReceiptMB} MB)</label>
      ${rc ? `<div class="receipt"><span>📎</span><span class="nm">${esc(rc.name)}${rc.pending ? ` · ${(rc.size / 1048576).toFixed(1)} MB · uploads when you save` : ""}</span>
          ${rc.pending && rc.img ? `<button class="btn-sm btn-pri" data-act="d-ocr" ${D.ocr === "busy" ? "disabled" : ""}>${D.ocr === "busy" ? "Reading…" : "🔍 Read receipt (beta)"}</button>` : ""}
          ${!rc.pending && D.receipt ? `<button class="btn-sm btn-ghost" data-act="d-view-receipt">View</button>` : ""}<button class="btn-sm btn-ghost" data-act="d-rm-receipt">Remove</button></div>
          ${D.ocrMsg ? `<div class="note" style="margin-top:6px">${esc(D.ocrMsg)}</div>` : ""}`
        : `<div class="actions"><button class="btn-ghost" data-act="d-pick-file">📷 Photo / 📁 file</button></div>`}
      <input type="file" id="dFile" accept="application/pdf,image/jpeg,image/png,image/webp" hidden>
      ${D.saving ? `<div class="progress"><div style="width:${Math.round(D.progress * 100)}%"></div></div><div class="note">${D.progress > 0 && D.progress < 1 ? "Uploading… " + Math.round(D.progress * 100) + "%" : "Saving and waiting for confirmation…"}</div>` : ""}
      ${D.error ? `<div class="err">⛔ ${esc(D.error)}${D.authErr ? `<div style="margin-top:10px"><button class="btn-pri" data-act="d-reconnect">Sign in again (your draft is kept)</button></div>` : ""}<div class="note">Nothing was saved twice.</div></div>` : ""}
      <div class="sheet-foot">
        ${!D.isNew ? `<button class="btn-bad" data-act="d-delete" ${D.saving ? "disabled" : ""}>🗑 Delete</button>` : ""}
        <span class="grow"></span>
        <button class="btn-ghost" data-act="d-cancel" ${D.saving ? "disabled" : ""}>Cancel</button>
        <button class="btn-ok" data-act="d-save" ${D.saving || (S.mode === "google" && !S.online) ? "disabled" : ""}>${D.saving ? "Saving…" : "✓ Save"}</button>
      </div>
      ${S.mode === "google" && !S.online ? `<div class="note" style="text-align:right">Offline: Save is off until you're back online.</div>` : ""}`;
  }
  function validateDraft() {
    const a = parseFloat(D.amount);
    if (!(a > 0)) return "Enter an amount above zero.";
    if (a > 1e9) return "That amount looks too large. Please check it.";
    if (Math.round(a * 100) / 100 !== a) return "Use at most 2 decimal places.";
    if (!C.currencies.includes(D.currency)) return "Choose the currency.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(D.date || "")) return "Choose a date.";
    if (D.kind === "expense") { if (!tabById(D.tabId)) return "Choose which expense tab this belongs to."; if (!String(D.description).trim()) return "Add a short description."; }
    else { const s = srcById(D.sourceId); if (!s) return "Choose an income source."; if (s.needsDetail && !String(D.service).trim()) return `“${s.name}” needs a short description of the client, service or deal in the “For” box.`; }
    return "";
  }
  function safeFileName(name) {
    const ext = (name.match(/\.[a-z0-9]{2,5}$/i) || [""])[0].toLowerCase();
    const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim().slice(0, 50) || "receipt";
    const where = D.kind === "expense" ? (tabById(D.tabId) || {}).short : (srcById(D.sourceId) || {}).name;
    return `${D.date}_${String(where || "").replace(/[^\w\-]+/g, "-")}_${base}${ext}`;
  }
  async function saveDraft() {
    if (!D || D.saving) return;
    const err = validateDraft(); if (err) { D.error = err; D.authErr = false; renderSheet(); return; }
    if (S.mode === "google" && !S.online) { D.error = "You're offline. Nothing was saved."; renderSheet(); return; }
    const d = D;
    if (d.currency !== RC && !d.rate) {
      d.rateState = "loading"; paintRate();
      try { d.rate = await R.toCAD(d.currency, d.date); d.rateState = "ok"; } catch (e) { d.rateState = "fail"; }
      paintRate();
      if (!d.rate && !(await confirmDialog("Exchange rate unavailable", `I couldn't get the ${d.currency}→${RC} rate right now. Save the entry in ${d.currency} and mark the ${RC} amount as “rate pending”? You can fill it in later with “Get rates now”.`, "Save with rate pending", false))) return;
    }
    d.saving = true; d.error = ""; d.authErr = false; d.progress = 0; renderSheet();
    try {
      let receipt = d.removeReceipt ? null : d.receipt;
      if (d.pendingFile && !d.uploaded) d.uploaded = await S.store.uploadReceipt(d.pendingFile, { name: safeFileName(d.pendingFile.name), linkedId: d.id }, f => { d.progress = f; if (D === d) renderSheet(); });
      if (d.uploaded) receipt = d.uploaded;
      const amountMinor = Math.round(parseFloat(d.amount) * 100);
      const base = { id: d.id, date: d.date, currency: d.currency, amountMinor,
        rateToCAD: d.rate ? d.rate.rate : "", rateDate: d.rate ? d.rate.rateDate : "", rateSource: d.rate ? d.rate.source : "",
        cadMinor: d.rate ? Math.round(amountMinor * d.rate.rate) : null,
        receiptId: receipt ? receipt.receiptId : "", receiptName: receipt ? receipt.receiptName : "", receiptLink: receipt ? receipt.receiptLink : "",
        receiptHash: receipt ? (d.pendingFile ? d.receiptHash : (d.receiptHash || "")) : "", entryMethod: d.method };
      if (d.createdAt) base.createdAt = d.createdAt;
      const rec = d.kind === "expense"
        ? Object.assign(base, { tabId: d.tabId, tabName: tabById(d.tabId).name, description: String(d.description).trim() })
        : Object.assign(base, { sourceId: d.sourceId, sourceName: srcById(d.sourceId).name, payer: String(d.payer).trim(), service: String(d.service).trim(), notes: String(d.notes).trim() });
      const { record } = await S.store.save(d.kind, rec);
      if (d.oldReceiptId && d.oldReceiptId !== rec.receiptId) S.store.trashReceipt(d.oldReceiptId).catch(() => {});
      const arr = d.kind === "expense" ? S.expenses : S.income;
      const i = arr.findIndex(r => r.id === record.id); if (i >= 0) arr[i] = record; else arr.push(record);
      SS("draft").del(); closeDraft(); render();
      toast(S.mode === "google" ? "Saved ✓ (confirmed by Google)" : "Saved ✓ (on this device)", "ok");
    } catch (e) {
      d.saving = false; d.error = e.message || String(e); d.authErr = isAuthErr(e);
      if (d.authErr) S.connected = false;
      if (D === d) renderSheet(); render();
    }
  }
  async function deleteDraftRecord() {
    const d = D; if (!d || d.isNew) return;
    const ok = await confirmDialog("Delete this entry?", `${money(Math.round(parseFloat(d.amount) * 100), d.currency)} on ${longDate(d.date)} will be removed${d.receipt ? " and its file moved to the Drive bin" : ""}. This can't be undone from the app.`, "Delete", true, "Keep it");
    if (!ok) return;
    d.saving = true; renderSheet();
    try {
      await S.store.remove(d.kind, d.id);
      if (d.oldReceiptId) S.store.trashReceipt(d.oldReceiptId).catch(() => {});
      if (d.kind === "expense") S.expenses = S.expenses.filter(r => r.id !== d.id); else S.income = S.income.filter(r => r.id !== d.id);
      closeDraft(); render(); toast("Deleted", "ok");
    } catch (e) { d.saving = false; d.error = e.message; d.authErr = isAuthErr(e); renderSheet(); }
  }
  async function sha256(file) {
    try { const b = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); } catch (e) { return ""; }
  }
  async function pickFile(file) {
    if (!file || !D) return;
    if (!C.receiptTypes[file.type]) { D.error = `“${file.name}” isn't a PDF, JPG, PNG or WEBP file. On iPhone, pick the photo from the Photos option.`; renderSheet(); return; }
    if (file.size > C.maxReceiptMB * 1048576) { D.error = `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${C.maxReceiptMB} MB.`; renderSheet(); return; }
    if (!file.size) { D.error = "That file is empty."; renderSheet(); return; }
    D.pendingFile = file; D.uploaded = null; D.error = ""; D.ocrMsg = "";
    D.receiptHash = await sha256(file);
    const dup = D.receiptHash && [...S.expenses, ...S.income].find(r => r.receiptHash === D.receiptHash && r.id !== D.id);
    if (dup) D.flags = D.flags.concat([["warn", `This exact file is already attached to “${dup.description || dup.payer || "an entry"}” on ${longDate(dup.date)}. Make sure this isn't a duplicate.`]]);
    renderSheet();
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error("Couldn't download the receipt reader. Check your internet.")); document.head.appendChild(s); });
  }
  async function ocrReceipt() {
    const d = D; if (!d || !d.pendingFile) return;
    d.ocr = "busy"; d.ocrMsg = "Downloading the free receipt reader (first time only, about 10–15 MB)…"; renderSheet();
    try {
      if (!self.Tesseract) await loadScript(C.ocrScript);
      const worker = await self.Tesseract.createWorker("eng", 1, { logger: m => { if (D === d && m.status === "recognizing text") { d.ocrMsg = `Reading receipt… ${Math.round((m.progress || 0) * 100)}%`; const n = document.querySelector(".receipt + .note"); if (n) n.textContent = d.ocrMsg; } } });
      const { data } = await worker.recognize(d.pendingFile);
      await worker.terminate();
      if (D !== d) return;
      const r = P.parseReceiptText(data.text, { now: new Date() });
      if (r.amount != null) d.amount = r.amount;
      if (r.date) d.date = r.date;
      if (r.currency) d.currency = r.currency;
      const extra = [r.invoiceNo ? `Invoice ${r.invoiceNo}` : "", r.taxes ? `Tax: ${r.taxes}` : ""].filter(Boolean).join(" · ");
      if (d.kind === "expense") d.description = [r.merchant || d.description, extra].filter(Boolean).join(" · ");
      else { if (r.merchant && !d.payer) d.payer = r.merchant; if (extra) d.notes = [d.notes, extra].filter(Boolean).join(" · "); }
      d.flags = [["ok", "Filled in from the receipt. Check every field before saving; receipt reading can make mistakes."]].concat(r.flags);
      d.ocr = ""; d.ocrMsg = ""; refreshRate(); renderSheet();
    } catch (e) {
      if (D !== d) return; d.ocr = ""; d.ocrMsg = ""; d.flags = [["bad", `Couldn't read the receipt (${e.message || e}). Please type the details.`]]; renderSheet();
    }
  }
  function stashDraft() {
    if (!D) return;
    const keep = Object.assign({}, D, { pendingFile: null, saving: false, error: "", authErr: false, hadFile: !!D.pendingFile && !D.uploaded });
    SS("draft").set(JSON.stringify(keep));
  }
  function restoreDraft() {
    const raw = SS("draft").get(""); if (!raw || !S.connected) return;
    SS("draft").del();
    try {
      const k = JSON.parse(raw); D = k;
      D.flags = [["ok", "Your draft was kept while you signed in." + (k.hadFile ? " Please attach the receipt again." : "")]];
      renderSheet(); $("#sheet").hidden = false; refreshRate();
    } catch (e) {}
  }

  /* ---------- rates catch-up ---------- */
  async function fixRates() {
    const todo = pendingRows(); if (!todo.length) return;
    S.busy = true; render(); let ok = 0, fail = 0;
    for (const [kind, r] of todo) {
      try {
        const rt = await R.toCAD(r.currency, r.date);
        const { record } = await S.store.save(kind, Object.assign({}, r, { rateToCAD: rt.rate, rateDate: rt.rateDate, rateSource: rt.source, cadMinor: Math.round(r.amountMinor * rt.rate) }));
        const arr = kind === "expense" ? S.expenses : S.income; const i = arr.findIndex(x => x.id === r.id); if (i >= 0) arr[i] = record;
        ok++;
      } catch (e) { fail++; if (isAuthErr(e)) { handleErr(e); break; } }
    }
    S.busy = false; render();
    toast(fail ? `Got ${ok} rates. ${fail} still pending; try again later.` : `All ${ok} rates filled in ✓`, fail ? "bad" : "ok");
  }

  /* ---------- CSV ---------- */
  function cell(v) { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }
  const EX_HEAD = ["Date", "Tab", "Description", "Currency", "Amount", `Rate to ${RC}`, "Rate date", "Rate source", `Amount ${RC}`, "Receipt name", "Receipt link", "Entry method", "ID", "Created at", "Updated at"];
  const IN_HEAD = ["Date", "Source", "From", "For", "Note", "Currency", "Amount", `Rate to ${RC}`, "Rate date", "Rate source", `Amount ${RC}`, "Receipt name", "Receipt link", "Entry method", "ID", "Created at", "Updated at"];
  function downloadCsv(kind, rows, label) {
    const fx = r => { const c = cadOf(r); return [r.currency, (r.amountMinor / 100).toFixed(2), r.rateToCAD == null ? "" : r.rateToCAD, r.rateDate || "", r.rateSource || "", c === null ? "RATE PENDING" : (c / 100).toFixed(2)]; };
    const body = sortRows(rows).map(r => kind === "expense"
      ? [r.date, (tabById(r.tabId) || {}).name || r.tabName, r.description, ...fx(r), r.receiptName, r.receiptLink, r.entryMethod, r.id, r.createdAt, r.updatedAt]
      : [r.date, srcName(r), r.payer, r.service, r.notes, ...fx(r), r.receiptName, r.receiptLink, r.entryMethod, r.id, r.createdAt, r.updatedAt]);
    const csv = "﻿" + [kind === "expense" ? EX_HEAD : IN_HEAD, ...body].map(row => row.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `manish-${kind}-${String(label || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today()}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Exported ${body.length} rows`, "ok");
  }
  function parseCsv(text) {
    const rows = []; let row = [], f = "", q = false; text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  const unq = s => String(s || "").replace(/^'(?=[=+\-@])/, "");
  async function importCsv(file) {
    const rows = parseCsv(await file.text()); if (rows.length < 2) { toast("That file has no rows.", "bad"); return; }
    const h = rows[0].map(x => x.trim().toLowerCase()), ix = n => h.indexOf(n.toLowerCase());
    const kind = ix("tab") >= 0 ? "expense" : ix("source") >= 0 ? "income" : null;
    if (!kind || ix("currency") < 0) { toast("Please choose a CSV exported from this app.", "bad"); return; }
    const recs = []; let bad = 0;
    for (const r of rows.slice(1)) {
      const g = n => (ix(n) >= 0 ? r[ix(n)] || "" : "").trim();
      const amt = parseFloat(g("amount")), cur = g("currency").toUpperCase(), date = g("date");
      if (!(amt > 0) || !C.currencies.includes(cur) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad++; continue; }
      const rate = parseFloat(g(`rate to ${RC}`)), amountMinor = Math.round(amt * 100);
      const base = { id: g("id") || ST.uid(), date, currency: cur, amountMinor, rateToCAD: rate > 0 ? rate : "", rateDate: g("rate date"), rateSource: g("rate source"), cadMinor: rate > 0 ? Math.round(amountMinor * rate) : null, receiptId: "", receiptName: g("receipt name"), receiptLink: g("receipt link"), receiptHash: "", entryMethod: "restore", createdAt: g("created at") || undefined };
      if (kind === "expense") { const t = TABS.find(t => t.name.toLowerCase() === g("tab").toLowerCase()); if (!t) { bad++; continue; } recs.push(Object.assign(base, { tabId: t.id, tabName: t.name, description: unq(g("description")) || "(restored)" })); }
      else { const s = SRCS.find(s => s.name.toLowerCase() === g("source").toLowerCase()); if (!s) { bad++; continue; } recs.push(Object.assign(base, { sourceId: s.id, sourceName: s.name, payer: unq(g("from")), service: unq(g("for")), notes: unq(g("note")) })); }
    }
    const existing = new Set((kind === "expense" ? S.expenses : S.income).map(r => r.id)), fresh = recs.filter(r => !existing.has(r.id));
    const msg = `${fresh.length} new ${kind} rows will be added; ${recs.length - fresh.length} already exist and will be skipped.${bad ? ` ${bad} rows couldn't be read and will be skipped.` : ""}`;
    if (!fresh.length) { await confirmDialog("Nothing new to restore", msg, "OK", false); return; }
    if (!(await confirmDialog("Restore these rows?", msg, `Restore ${fresh.length}`, false))) return;
    S.busy = true; render();
    try { const n = await S.store.bulkAdd(kind, fresh); await loadAll(); toast(`Restored ${n} rows ✓`, "ok"); } catch (e) { handleErr(e); }
    S.busy = false; render();
  }

  /* ---------- events ---------- */
  const ACT = {
    go: el => { S.view = el.dataset.v; S.q = ""; render(); scrollTo(0, 0); },
    "go-src": el => { S.view = "income"; S.incomeSource = el.dataset.v; render(); scrollTo(0, 0); },
    refresh, connect: connectGoogle, "fix-rates": fixRates,
    "start-demo": async () => {
      if (S.mode === "google" && !(await confirmDialog("Switch to demo mode?", "Your Google data stays safe in your Sheet. Demo entries are kept separately on this device only.", "Switch", false))) return;
      try { await useDemo(true); } catch (e) { toast(e.message, "bad"); } render();
    },
    "start-google": connectGoogle,
    "save-cid": () => {
      const v = (document.querySelector("[data-f=cid]").value || "").trim();
      if (v && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) { toast("That doesn't look like a Client ID. It ends with .apps.googleusercontent.com", "bad"); return; }
      LS("client-id").set(v); toast("Saved on this device", "ok"); render();
    },
    signout: async () => {
      if (!(await confirmDialog("Sign out of Google?", "Your data stays in your Google Sheet. You'll sign in again next time.", "Sign out", false))) return;
      S.store.signOut(); S.connected = false; S.ready = false; S.expenses = []; S.income = []; render();
    },
    install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); },
    period: el => { S.period = el.dataset.v; render(); },
    "pick-src": el => { S.incomeSource = el.dataset.v || null; render(); },
    "mic-tab": () => listen(t => handleSpokenExpense(t, S.view)),
    "type-mic-tab": () => typeIn(t => handleSpokenExpense(t, S.view)),
    "mic-income": () => listen(handleSpokenIncome),
    "type-mic-income": () => typeIn(handleSpokenIncome),
    "add-expense": () => openDraft({ kind: "expense", tabId: tabById(S.view) ? S.view : null, method: "manual" }),
    "add-income": () => openDraft({ kind: "income", sourceId: S.incomeSource, method: "manual" }),
    edit: el => { const arr = el.dataset.k === "expense" ? S.expenses : S.income, r = arr.find(x => x.id === el.dataset.id); if (r) openDraft({ kind: el.dataset.k, rec: r }); },
    csv: el => {
      const k = el.dataset.k; let rows = k === "expense" ? S.expenses : S.income, label = "all";
      if (el.dataset.tab) { rows = filterRows(rows.filter(r => r.tabId === el.dataset.tab)); label = tabById(el.dataset.tab).short + "-" + periodLabel(S.period); }
      else if (el.dataset.src !== undefined) { if (el.dataset.src) rows = rows.filter(r => r.sourceId === el.dataset.src); rows = filterRows(rows); label = (el.dataset.src ? srcById(el.dataset.src).name : "all") + "-" + periodLabel(S.period); }
      downloadCsv(k, rows, label);
    },
    import: () => { const f = $("#importFile"); f.value = ""; f.onchange = () => f.files[0] && importCsv(f.files[0]); f.click(); },
    lstop: () => rec && rec.stop(),
    lcancel: () => { if (rec) { recCancelled = true; rec.abort(); } },
    "mic-draft": () => listen(handleSpokenInDraft),
    "d-tab": el => { D.tabId = el.dataset.v; renderSheet(); },
    "d-src": el => { D.sourceId = el.dataset.v; renderSheet(); },
    "d-cur": el => { D.currency = el.dataset.v; renderSheet(); refreshRate(); },
    "d-pick-file": () => { const f = $("#dFile"); f.value = ""; f.onchange = () => pickFile(f.files[0]); f.click(); },
    "d-rm-receipt": () => { if (D.pendingFile) { D.pendingFile = null; D.uploaded = null; D.receiptHash = ""; } else if (D.uploaded) D.uploaded = null; else D.removeReceipt = true; D.ocrMsg = ""; renderSheet(); },
    "d-view-receipt": async () => { try { await S.store.openReceipt(D.receipt); } catch (e) { toast(e.message, "bad"); } },
    "d-ocr": ocrReceipt,
    "d-cancel": async () => { if (D.isNew && (D.amount || D.description) && !(await confirmDialog("Discard this draft?", "Nothing has been saved yet.", "Discard", true, "Keep editing"))) return; SS("draft").del(); closeDraft(); },
    "d-save": saveDraft,
    "d-delete": deleteDraftRecord,
    "d-reconnect": () => { stashDraft(); connectGoogle(); },
  };
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
    if (el.tagName === "A") e.preventDefault();
    const fn = ACT[el.dataset.act]; if (fn) fn(el, e);
  });
  document.addEventListener("input", e => {
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    if (D && e.target.closest("#sheet") && ["amount", "date", "description", "payer", "service", "notes"].includes(f)) { D[f] = e.target.value; if (f === "amount") paintRate(); return; }
    if (f === "q") { S.q = e.target.value; clearTimeout(ACT._qt); ACT._qt = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const n = document.querySelector("[data-f=q]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 250); }
  });
  document.addEventListener("change", async e => {
    const f = e.target.dataset && e.target.dataset.f; if (!f) return;
    if (D && f === "date" && e.target.closest("#sheet")) { D.date = e.target.value; refreshRate(); return; }
    if (f === "month" && e.target.value) { S.period = "ym:" + e.target.value; render(); }
    if (f === "from" || f === "to") {
      const a = (document.querySelector("[data-f=from]") || {}).value || "", b = (document.querySelector("[data-f=to]") || {}).value || "";
      if (a && b) { if (a > b) { toast("The “from” date must be before the “to” date", "bad"); return; } S.period = `r:${a}|${b}`; render(); }
    }
    if (f === "lang") { S.settings.speechLang = e.target.value; try { await S.store.saveSettings(S.settings); toast("Voice language saved", "ok"); } catch (x) { handleErr(x); } }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#sheet").hidden && D && !D.saving) closeDraft();
    if (e.key === "Enter" && D && e.target.closest && e.target.closest("#sheet") && e.target.tagName === "INPUT") { e.preventDefault(); saveDraft(); }
  });
  window.addEventListener("resize", () => { clearTimeout(ACT._rt); ACT._rt = setTimeout(renderNav, 200); });

  self.__mmm = { S, ACT, parseCsv, cell, cadOf };
  boot();
})();
