/* Exchange rates → CAD. Free, no key: Frankfurter (central-bank reference rates).
   Policy: each entry is converted at the reference rate for its OWN transaction date
   (or the closest earlier published day). The rate is saved with the entry and never
   silently changed later. If the service can't be reached, the entry keeps its original
   amount and is marked "rate pending". */
(function (root) {
  "use strict";
  const C = root.APP_CONFIG;
  const KEY = (C.storagePrefix || "app") + "-rates";
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {} };
  const todayIso = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  async function getJson(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    try { const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  function pick(j, from, to) {
    // v1: { base, date, rates: { CAD: 1.39 } }
    if (j && j.rates && typeof j.rates[to] === "number") return { rate: j.rates[to], date: j.date };
    // v2 (tolerant): array of { date, base, quote, rate } or { rate, date }
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : null);
    if (arr) { const hit = arr.find(x => String(x.quote || x.symbol || "").toUpperCase() === to); if (hit && typeof hit.rate === "number") return { rate: hit.rate, date: hit.date }; }
    if (j && typeof j.rate === "number") return { rate: j.rate, date: j.date };
    return null;
  }

  /** Returns { rate, rateDate, source } or throws. rate = how many CAD for 1 unit of `from`. */
  async function toCAD(from, date) {
    from = String(from).toUpperCase();
    const to = C.reportCurrency || "CAD";
    if (from === to) return { rate: 1, rateDate: date, source: "same currency" };
    const asOf = !date || date >= todayIso() ? "latest" : date;
    const k = `${from}|${asOf}`;
    if (asOf !== "latest" && cache[k]) return cache[k];
    const urls = [
      `${C.rateApi}/v1/${asOf}?base=${from}&symbols=${to}`,
      `${C.rateApi}/v2/rates?${asOf === "latest" ? "" : `date=${asOf}&`}base=${from}&quotes=${to}`,
    ];
    let lastErr;
    for (const u of urls) {
      try {
        const p = pick(await getJson(u), from, to);
        if (p && p.rate > 0) {
          const out = { rate: p.rate, rateDate: p.date || asOf, source: C.rateSourceLabel };
          if (asOf !== "latest") { cache[k] = out; save(); }
          return out;
        }
      } catch (e) { lastErr = e; }
    }
    throw new Error("Exchange-rate service unavailable" + (lastErr ? ` (${lastErr.message})` : ""));
  }

  root.Rates = { toCAD };
})(self);
