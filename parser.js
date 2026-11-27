/* Manish Expense Manager: spoken command parser (multi-currency).
   Turns a transcript into an intent + editable draft. Never saves anything itself.
   Never guesses a currency silently: ambiguous or missing currency is returned as null with a flag. */
(function (root) {
  "use strict";
  const SMALL = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
  const MULT = { hundred:100, thousand:1000, lakh:100000, lakhs:100000, lac:100000, crore:10000000, crores:10000000, million:1000000, k:1000 };
  const WEEK = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const MON = MONTHS.join("|");

  const CUR_RULES = [
    ["USD", /\b(?:us|u\.s\.?|american)\s+(?:dollars?|bucks)\b|\busd\b|\bus\$|\bu\.s\.\s*dollars?\b/],
    ["CAD", /\b(?:canadian)\s+(?:dollars?|bucks)\b|\bcad\b|\bc\$|\bca\$|\bloonies?\b/],
    ["INR", /\brupees?\b|\binr\b|\brs\.?(?=\s|\d|$)|₹/],
    ["GBP", /\b(?:pounds?(?:\s+sterling)?|gbp|quid|sterling)\b|£/],
    ["EUR", /\b(?:euros?|eur)\b|€/],
  ];
  const DOLLAR = /\b(?:dollars?|bucks)\b|\$/;

  function iso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

  function wordsToDigits(text) {
    const toks = text.split(/\s+/), out = [];
    let inRun = false, total = 0, group = 0;
    const flush = () => { if (inRun) out.push(String(total + group)); inRun = false; total = 0; group = 0; };
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i].toLowerCase().replace(/[^a-z-]/g, "");
      const parts = w.split("-");
      if (w && parts.every(p => p in SMALL)) { inRun = true; parts.forEach(p => { group += SMALL[p]; }); continue; }
      if (w !== "k" && w in MULT && (inRun || /^(a|one)$/i.test(toks[i - 1] || ""))) {
        if (!inRun && out.length && /^(a|one)$/i.test(out[out.length - 1])) out.pop();
        inRun = true;
        if (w === "hundred") group = (group || 1) * 100; else { total += (group || 1) * MULT[w]; group = 0; }
        continue;
      }
      if (w === "and" && inRun && toks[i + 1] && (toks[i + 1].toLowerCase().replace(/[^a-z]/g, "") in SMALL)) continue;
      flush(); out.push(toks[i]);
    }
    flush(); return out.join(" ");
  }

  function normalize(raw) {
    return wordsToDigits(String(raw || ""))
      .replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d),(?=\d)/g, "$1")
      .replace(/\b(\d+(?:\.\d+)?)\s*(hundred|thousand|lakhs?|lac|crores?|million)\b/gi, (_, n, w) => String(Math.round(parseFloat(n) * MULT[w.toLowerCase()])))
      .replace(/([₹$£€])\s+/g, "$1")
      .replace(/\s+/g, " ").trim();
  }

  /** Returns { currency: "USD"|...|null, how, ambiguous } */
  function findCurrency(t) {
    const hits = CUR_RULES.filter(([, re]) => re.test(t)).map(([c]) => c);
    let rest = t; CUR_RULES.forEach(([, re]) => { rest = rest.replace(new RegExp(re.source, "g"), " "); });
    const bareDollar = DOLLAR.test(rest);
    if (hits.length > 1) return { currency: null, how: `more than one currency (${hits.join(", ")})`, ambiguous: true };
    if (hits.length === 1) return { currency: hits[0], how: "spoken" };
    if (bareDollar) return { currency: null, how: "“dollars” without saying US or Canadian", ambiguous: true, dollar: true };
    return { currency: null, how: "not said" };
  }

  const AMT_RE = /(₹|\$|£|€|\bc\$|\bca\$|\bus\$|\brs\.?|\binr\b|\bcad\b|\busd\b|\bgbp\b|\beur\b)?\s*(\d+(?:\.\d{1,2})?)(?!\s*(?:st|nd|rd|th)\b)(?!\s*(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b)\s*(k\b|(?:us\s+|u\.s\.\s+|canadian\s+|american\s+)?(?:dollars?|bucks)\b|rupees?\b|pounds?\b|euros?\b|rs\b|inr\b|cad\b|usd\b|gbp\b|eur\b|\/-)?/gi;
  function findAmounts(t) {
    const found = []; let m; AMT_RE.lastIndex = 0;
    while ((m = AMT_RE.exec(t))) {
      const before = t.slice(0, m.index);
      if (new RegExp(`\\b(${MON})\\s*$`).test(before)) continue;
      let v = parseFloat(m[2]); if (isNaN(v)) continue;
      if (m[3] && /^k$/i.test(m[3])) v *= 1000;
      found.push({ v, marked: !!(m[1] || (m[3] && !/^k$/i.test(m[3]))), raw: m[0].trim() });
    }
    return found;
  }

  function findDate(t, now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/day before yesterday/.test(t)) { d.setDate(d.getDate() - 2); return { date: iso(d), how: "day before yesterday" }; }
    if (/\byesterday\b/.test(t)) { d.setDate(d.getDate() - 1); return { date: iso(d), how: "yesterday" }; }
    if (/\btoday\b/.test(t)) return { date: iso(d), how: "today" };
    const wk = t.match(/\b(?:last |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (wk) { let diff = (d.getDay() - WEEK.indexOf(wk[1]) + 7) % 7; if (diff === 0) diff = 7; d.setDate(d.getDate() - diff); return { date: iso(d), how: `last ${wk[1]}`, ambiguous: true }; }
    const a = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MON})\\b`));
    const b = a ? null : t.match(new RegExp(`\\b(${MON})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (a || b) {
      const day = +(a ? a[1] : b[2]), mon = MONTHS.indexOf(a ? a[2] : b[1]);
      const x = new Date(now.getFullYear(), mon, day);
      if (x > now) x.setFullYear(x.getFullYear() - 1);
      return { date: iso(x), how: "spoken date" };
    }
    return { date: iso(d), how: "not said, so I assumed today", ambiguous: true };
  }

  function stripDates(s) {
    return s
      .replace(new RegExp(`\\b(?:on\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MON})|(?:${MON})\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`, "g"), " ")
      .replace(/\b(?:on\s+|last\s+|this\s+)?(?:day before yesterday|today|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, " ");
  }
  function stripCurrency(s) {
    s = s.replace(/\b(?:us|u\.s\.?|american|canadian)\s+(?:dollars?|bucks)\b/g, " ");
    CUR_RULES.forEach(([, re]) => { s = s.replace(new RegExp(re.source, "g"), " "); });
    return s.replace(/\b(?:dollars?|bucks)\b|[$£€₹]/g, " ");
  }
  function findTab(t, tabs) {
    let best = null, bestLen = 0;
    for (const tab of tabs || []) for (const k of tab.voiceKeys || []) if (t.includes(k) && k.length > bestLen) { best = tab.id; bestLen = k.length; }
    return best;
  }
  function stripTab(s, tabs) {
    const keys = []; (tabs || []).forEach(tab => (tab.voiceKeys || []).forEach(k => keys.push(k)));
    keys.sort((a, b) => b.length - a.length).forEach(k => { s = s.split(k).join(" "); });
    return s.replace(/\b(under|in|for)\s+(the\s+)?(tab|account)?\s*$/g, " ");
  }
  function recase(s, t, cased) {
    if (!s || !cased) return s;
    const i = t.indexOf(s.toLowerCase());
    return i >= 0 ? cased.substr(i, s.length) : s;
  }
  function tidy(s, t, cased) {
    s = s.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").replace(/\b(on|for|under|in|from|to|the|and|of)$/g, "").trim();
    s = recase(s, t, cased);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function pickAmount(t, flags) {
    const amts = findAmounts(t), marked = amts.filter(a => a.marked);
    let amt = null;
    if (marked.length === 1) amt = marked[0];
    else if (amts.length === 1) amt = amts[0];
    else if (amts.length > 1) { amt = marked[0] || amts[0]; flags.push(["warn", `I heard more than one number (${amts.map(a => a.raw).join(", ")}). Check the amount.`]); }
    if (!amt) flags.push(["bad", "I didn't hear an amount. Type it in or try again."]);
    else if (!(amt.v > 0)) flags.push(["bad", "The amount must be more than zero."]);
    return amt;
  }
  function commonFlags(t, flags) {
    if (/\b(not|didn't|did not|don't|never|no)\b/.test(t)) flags.push(["warn", "I heard a negative word (not / didn't / no). Please make sure this entry is real."]);
  }
  const CUR_WORD = { usd: "USD", "us dollars": "USD", "american dollars": "USD", cad: "CAD", "canadian dollars": "CAD", inr: "INR", rupees: "INR", gbp: "GBP", pounds: "GBP", eur: "EUR", euros: "EUR" };

  function parseControl(t, tabs) {
    if (/^(cancel|cancel it|never mind|discard)\b/.test(t)) return { intent: "cancel" };
    if (/^(save|save it|confirm|yes,? save|ok save)\b/.test(t)) return { intent: "save" };
    const ca = t.match(/\b(?:correct|change|update|make|set)\s+(?:the\s+)?amount\s+(?:to\s+)?(?:[₹$£€]|rs\.?\s*)?(\d+(?:\.\d{1,2})?)/);
    if (ca) return { intent: "correct", field: "amount", value: parseFloat(ca[1]) };
    const cc = t.match(/\b(?:correct|change|update|set|make)\s+(?:the\s+)?currency\s+(?:to\s+)?(.+)/);
    if (cc) { const c = findCurrency(cc[1]); const v = c.currency || CUR_WORD[cc[1].trim()] || null; return v ? { intent: "correct", field: "currency", value: v } : { intent: "unclear" }; }
    const cd = t.match(/\b(?:correct|change|update|set)\s+(?:the\s+)?date\s+(?:to\s+)?(.+)/);
    if (cd) return { intent: "correct", field: "date", value: findDate(cd[1], new Date()).date };
    const cx = t.match(/\b(?:correct|change|update|set)\s+(?:the\s+)?(?:description|note)\s+(?:to\s+)?(.+)/);
    if (cx) return { intent: "correct", field: "description", value: tidy(cx[1]) };
    if (/^(show|list|display|open)\b/.test(t)) {
      let period = "month";
      if (/\blast month\b/.test(t)) period = "lastmonth"; else if (/\btoday\b/.test(t)) period = "today";
      else if (/\b(this year|year)\b/.test(t)) period = "year"; else if (/\ball\b/.test(t)) period = "all";
      const m = t.match(new RegExp(`\\b(${MON})\\b`)); if (m) period = "m:" + MONTHS.indexOf(m[1]);
      return { intent: "show", kind: /\bincome\b/.test(t) ? "income" : "expense", tabId: findTab(t, tabs), period };
    }
    return null;
  }

  function parseExpense(raw, opts) {
    opts = opts || {}; const now = opts.now || new Date(), tabs = opts.tabs || [];
    const cased = normalize(raw), t = cased.toLowerCase();
    const ctl = parseControl(t, tabs); if (ctl) return Object.assign({ text: t }, ctl);
    if (/^(received|got paid|earned|income)\b/.test(t)) return Object.assign(parseIncome(raw, opts), { intent: "income-hint" });
    const flags = [];
    const amt = pickAmount(t, flags);
    commonFlags(t, flags);
    const cur = findCurrency(t);
    const dt = findDate(t, now); if (dt.ambiguous) flags.push(["warn", `Date ${dt.how}. Please check it.`]);
    const tabId = findTab(t, tabs);
    let s = amt ? t.replace(amt.raw.toLowerCase(), " ") : t;
    s = stripCurrency(stripTab(stripDates(s), tabs));
    s = s.replace(/\b(i\s+)?(spent|spend|paid|pay|add|added|expense|of)\b/g, " ");
    const m = s.match(/\b(?:on|for)\s+(.+)/); if (m) s = m[1];
    const description = tidy(s, t, cased);
    if (!description) flags.push(["warn", "I didn't hear a description. Please add one."]);
    return { intent: "expense", text: t, amount: amt ? amt.v : null, currency: cur.currency, currencyInfo: cur, date: dt.date, tabId, description, flags };
  }

  function parseIncome(raw, opts) {
    opts = opts || {}; const now = opts.now || new Date();
    const cased = normalize(raw), t = cased.toLowerCase();
    const ctl = parseControl(t, opts.tabs || []); if (ctl) return Object.assign({ text: t }, ctl);
    const flags = [];
    const amt = pickAmount(t, flags);
    commonFlags(t, flags);
    const cur = findCurrency(t);
    const dt = findDate(t, now); if (dt.ambiguous) flags.push(["warn", `Date ${dt.how}. Please check it.`]);
    let s = amt ? t.replace(amt.raw.toLowerCase(), " ") : t;
    s = stripCurrency(stripDates(s)).replace(/\b(i\s+)?(received|receive|got paid|got|earned|income|of|payment)\b/g, " ").replace(/\s+/g, " ").trim();
    let payer = "", service = "";
    const fm = s.match(/\bfrom\s+(.+?)(?:\s+(?:for|towards|against)\s+(.+))?$/);
    if (fm) { payer = fm[1]; service = fm[2] || ""; }
    else { const sm = s.match(/\b(?:for|towards|against)\s+(.+)$/); if (sm) service = sm[1]; }
    payer = tidy(payer, t, cased); service = tidy(service, t, cased);
    if (!payer) flags.push(["warn", "I didn't hear who paid you (say “from …”). Add it if you want."]);
    return { intent: "income", text: t, amount: amt ? amt.v : null, currency: cur.currency, currencyInfo: cur, date: dt.date, payer, service, flags };
  }

  /* ---------- receipt text (OCR) → suggested fields ---------- */
  function parseReceiptText(text, opts) {
    opts = opts || {};
    const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lower = lines.map(l => l.toLowerCase());
    const out = { flags: [] };
    const num = s => { const m = s.match(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2})(?!\d)/g); return m ? m.map(x => parseFloat(x.replace(/[,\s]/g, ""))) : []; };
    // total: prefer lines that say total / amount due / balance, but not subtotal
    let total = null;
    for (let i = lower.length - 1; i >= 0 && total === null; i--) {
      if (/(grand\s*total|amount\s*due|balance\s*due|total\s*due|\btotal\b|amount\s*paid)/.test(lower[i]) && !/sub\s*-?\s*total/.test(lower[i])) {
        const n = num(lines[i]); if (n.length) total = n[n.length - 1];
        else if (lines[i + 1]) { const n2 = num(lines[i + 1]); if (n2.length) total = n2[0]; }
      }
    }
    if (total === null) { const all = lines.flatMap(num); if (all.length) { total = Math.max(...all); out.flags.push(["warn", "I couldn't find a “Total” line, so I used the largest amount on the receipt."]); } }
    out.amount = total;
    // currency
    const whole = lower.join(" ");
    const c = findCurrency(whole.replace(/\$/g, " $"));
    if (c.currency) out.currency = c.currency;
    else if (/\bhst\b|\bgst\b|\bpst\b|\bqst\b|canada|ontario|\bon\s+[a-z]\d[a-z]/.test(whole) && /\$/.test(whole)) { out.currency = "CAD"; out.flags.push(["warn", "Currency guessed as CAD from Canadian tax/address. Please check."]); }
    else if (/\$/.test(whole)) out.flags.push(["warn", "The receipt shows “$”. Choose US or Canadian dollars."]);
    // date
    let date = null; const now = opts.now || new Date();
    for (const l of lower) {
      let m = l.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
      if (m) { date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; break; }
      m = l.match(new RegExp(`\\b(${MONTHS.map(x => x.slice(0, 3)).join("|")})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`));
      if (m) { date = `${m[3]}-${String(MONTHS.findIndex(x => x.startsWith(m[1])) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; break; }
      m = l.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.map(x => x.slice(0, 3)).join("|")})[a-z]*\\.?,?\\s+(20\\d{2})\\b`));
      if (m) { date = `${m[3]}-${String(MONTHS.findIndex(x => x.startsWith(m[2])) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; break; }
      m = l.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/);
      if (m) {
        let [, a, b, y] = m; if (y.length === 2) y = "20" + y;
        if (+a > 12) date = `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
        else if (+b > 12) date = `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
        else { date = `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`; out.flags.push(["warn", `The date ${m[0]} could be month-first or day-first. Please check it.`]); }
        break;
      }
    }
    if (date && date > iso(now)) { out.flags.push(["warn", "The date read from the receipt is in the future. Please check it."]); }
    out.date = date;
    // merchant: first line with 3+ letters that isn't a generic header
    out.merchant = (lines.find(l => /[a-z]{3,}/i.test(l) && !/receipt|invoice|tax|welcome|thank|date|time|tel|phone|www\.|http/i.test(l)) || "").replace(/[^\w&'.,\- ]+/g, "").trim().slice(0, 60);
    const inv = whole.match(/\b(?:invoice|inv|bill|receipt)\s*(?:no\.?|number|#|num)\s*[:#]?\s*([a-z0-9][a-z0-9\-\/]{2,})/i);
    if (inv) out.invoiceNo = inv[1].toUpperCase();
    const taxes = [];
    lines.forEach((l, i) => { if (/\b(hst|gst|pst|qst|vat|cgst|sgst|igst|tax)\b/i.test(l) && !/total/i.test(l)) { const n = num(l); if (n.length) taxes.push(`${(l.match(/\b(hst|gst|pst|qst|vat|cgst|sgst|igst|tax)\b/i) || ["Tax"])[0].toUpperCase()} ${n[n.length - 1].toFixed(2)}`); } });
    if (taxes.length) out.taxes = taxes.join(", ");
    if (out.amount == null) out.flags.push(["bad", "I couldn't read an amount. Please type it."]);
    return out;
  }

  const API = { parseExpense, parseIncome, parseReceiptText, normalize, wordsToDigits, findAmounts, findDate, findCurrency, iso };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.Parser = API;
})(typeof self !== "undefined" ? self : this);
