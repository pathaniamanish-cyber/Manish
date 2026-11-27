/* Storage adapters (same API for both):
     init(), list(kind), save(kind, rec), bulkAdd(kind, recs), remove(kind, id),
     uploadReceipt(file, meta, onProgress), openReceipt(rec), trashReceipt(id),
     getSettings(), saveSettings(obj), info()
   Money is stored in minor units (cents/paise) as integers. */
(function (root) {
  "use strict";
  const C = root.APP_CONFIG, PFX = C.storagePrefix || "app";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const nowIso = () => new Date().toISOString();
  const ss = { get(k) { try { return sessionStorage.getItem(PFX + "-" + k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(PFX + "-" + k, v); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(PFX + "-" + k); } catch (e) {} } };
  const ls = { get(k) { try { return localStorage.getItem(PFX + "-" + k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(PFX + "-" + k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(PFX + "-" + k); } catch (e) {} } };

  const COLS = {
    expense: { sheet: "Expenses", cols: ["id", "tabId", "tabName", "date", "currency", "amount", "amountMinor", "rateToCAD", "rateDate", "rateSource", "amountCAD", "cadMinor", "description", "receiptId", "receiptName", "receiptLink", "receiptHash", "entryMethod", "createdAt", "updatedAt"] },
    income: { sheet: "Income", cols: ["id", "sourceId", "sourceName", "date", "currency", "amount", "amountMinor", "rateToCAD", "rateDate", "rateSource", "amountCAD", "cadMinor", "payer", "service", "notes", "receiptId", "receiptName", "receiptLink", "receiptHash", "entryMethod", "createdAt", "updatedAt"] },
  };
  const AUDIT_COLS = ["eventId", "timestamp", "actor", "action", "kind", "recordId", "before", "after"];
  const colLetter = n => String.fromCharCode(64 + n);
  function derived(r) {
    const o = Object.assign({}, r);
    o.amount = (o.amountMinor / 100).toFixed(2);
    o.amountCAD = o.cadMinor === null || o.cadMinor === undefined || o.cadMinor === "" ? "" : (o.cadMinor / 100).toFixed(2);
    return o;
  }

  /* ---------------- Demo store: IndexedDB on this device only ---------------- */
  function LocalStore() {
    let db;
    const STORES = ["expense", "income", "receipts", "settings", "audit"];
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open(PFX + "-demo", 1);
      r.onupgradeneeded = () => STORES.forEach(s => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s, { keyPath: "id" }));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    function tx(store, mode, fn) {
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode), s = t.objectStore(store); let out;
        Promise.resolve(fn(s)).then(v => { out = v; });
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    }
    const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const self_ = {
      mode: "demo",
      async init() { db = await open(); return true; },
      info() { return { mode: "demo", label: "Demo · saved on this device only" }; },
      list(kind) { return tx(kind, "readonly", s => reqP(s.getAll())); },
      async save(kind, rec) {
        const r = await tx(kind, "readwrite", async s => {
          const before = await reqP(s.get(rec.id));
          const row = derived(Object.assign({}, before || {}, rec, { createdAt: before ? before.createdAt : (rec.createdAt || nowIso()), updatedAt: nowIso() }));
          s.put(row); return { record: row, created: !before, before };
        });
        await self_._audit(r.created ? "create" : "update", kind, rec.id, r.before, r.record);
        return r;
      },
      async bulkAdd(kind, recs) {
        const existing = new Set((await self_.list(kind)).map(r => r.id));
        const fresh = recs.filter(r => !existing.has(r.id));
        await tx(kind, "readwrite", s => { fresh.forEach(r => s.put(derived(Object.assign({ createdAt: nowIso() }, r, { updatedAt: nowIso() })))); });
        await self_._audit("import", kind, `${fresh.length} rows`, null, null);
        return fresh.length;
      },
      async remove(kind, id) {
        const before = await tx(kind, "readonly", s => reqP(s.get(id)));
        await tx(kind, "readwrite", s => s.delete(id));
        await self_._audit("delete", kind, id, before, null);
      },
      async uploadReceipt(file, meta, onProgress) {
        const id = uid(); onProgress && onProgress(1);
        await tx("receipts", "readwrite", s => s.put({ id, name: meta.name, type: file.type, blob: file, createdAt: nowIso() }));
        return { receiptId: id, receiptName: meta.name, receiptLink: "" };
      },
      async openReceipt(rec) {
        const r = await tx("receipts", "readonly", s => reqP(s.get(rec.receiptId)));
        if (!r) throw new Error("Receipt file not found on this device.");
        const url = URL.createObjectURL(r.blob); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      async trashReceipt(id) { if (id) await tx("receipts", "readwrite", s => s.delete(id)); },
      async getSettings() { const r = await tx("settings", "readonly", s => reqP(s.get("app"))); return (r && r.value) || {}; },
      async saveSettings(value) { await tx("settings", "readwrite", s => s.put({ id: "app", value })); },
      async _audit(action, kind, recordId, before, after) {
        await tx("audit", "readwrite", s => s.put({ id: uid(), timestamp: nowIso(), actor: "this device", action, kind, recordId, before: before ? JSON.stringify(before) : "", after: after ? JSON.stringify(after) : "" }));
      },
    };
    return self_;
  }

  /* ---------------- Google store: the owner's own Sheet + Drive folder ----------------
     Scope: drive.file only (the app sees only files it created).
     Sign-in uses a full-page redirect (no pop-ups), which works in Safari on Mac and iPhone,
     including apps added to the Dock / Home Screen. */
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  class AuthError extends Error { constructor(m) { super(m); this.name = "AuthError"; } }

  function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ""); }

  /** Call on page load. Picks up a token Google sent back in the URL. Returns true/false, throws AuthError on refusal. */
  function consumeRedirect() {
    if (!location.hash || !/access_token=|error=/.test(location.hash)) return false;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    const expected = ss.get("oauth-state"); ss.del("oauth-state");
    if (h.get("error")) throw new AuthError(h.get("error") === "access_denied" ? "Google sign-in was cancelled. Nothing was changed." : "Google sign-in failed: " + h.get("error"));
    if (!expected || h.get("state") !== expected) throw new AuthError("Sign-in check failed (security state mismatch). Please tap Connect again.");
    if (!String(h.get("scope") || "").split(" ").includes(SCOPE)) throw new AuthError("Permission to save files was not granted. Tap Connect again and tick the box to allow it.");
    ss.set("token", h.get("access_token"));
    ss.set("token-exp", String(Date.now() + (parseInt(h.get("expires_in"), 10) - 120) * 1000));
    return true;
  }

  function GoogleStore(clientId) {
    let ssId = null, folderId = null; const sheetIds = {};
    const token = () => { const t = ss.get("token"), e = +ss.get("token-exp") || 0; return t && Date.now() < e ? t : null; };
    function needToken() { const t = token(); if (!t) throw new AuthError("Your Google session has ended. Tap “Reconnect Google”."); return t; }

    async function api(url, opts = {}, retry = true) {
      const isJson = opts.body && typeof opts.body === "string";
      let res;
      try { res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: "Bearer " + needToken() }, isJson ? { "Content-Type": "application/json" } : {}, opts.headers || {}) })); }
      catch (e) { if (e instanceof AuthError) throw e; throw new Error("Couldn't reach Google. Check your internet connection."); }
      if (res.status === 401) { ss.del("token"); throw new AuthError("Your Google session has ended. Tap “Reconnect Google”."); }
      if ((res.status === 429 || res.status >= 500) && retry) { await new Promise(r => setTimeout(r, 1500)); return api(url, opts, false); }
      if (!res.ok) { let m = res.statusText; try { const j = await res.json(); m = (j.error && j.error.message) || m; } catch (e) {} throw new Error(`Google error ${res.status}: ${m}`); }
      return res.status === 204 ? null : res.json();
    }
    const q = encodeURIComponent;
    async function findByProp(value, mime) {
      const query = `appProperties has { key='${PFX}' and value='${value}' } and trashed=false and mimeType='${mime}'`;
      const r = await api(`${DRIVE}?q=${q(query)}&fields=files(id)&spaces=drive`);
      return r.files && r.files[0];
    }
    async function ensureFiles() {
      try { const c = JSON.parse(ls.get("google-ids") || "{}"); ssId = c.ssId; folderId = c.folderId; } catch (e) {}
      if (!ssId) { const f = await findByProp("data-v1", "application/vnd.google-apps.spreadsheet"); if (f) ssId = f.id; }
      if (!ssId) {
        const created = await api(SHEETS, { method: "POST", body: JSON.stringify({
          properties: { title: C.sheetTitle, locale: "en_CA", timeZone: C.timeZone },
          sheets: ["Expenses", "Income", "Settings", "Audit"].map(title => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
        }) });
        ssId = created.spreadsheetId;
        await api(`${SHEETS}/${ssId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: [
          { range: "Expenses!A1", values: [COLS.expense.cols] }, { range: "Income!A1", values: [COLS.income.cols] },
          { range: "Settings!A1", values: [["key", "value"]] }, { range: "Audit!A1", values: [AUDIT_COLS] }] }) });
        await api(`${DRIVE}/${ssId}`, { method: "PATCH", body: JSON.stringify({ appProperties: { [PFX]: "data-v1" } }) });
      }
      let meta;
      try { meta = await api(`${SHEETS}/${ssId}?fields=sheets.properties(sheetId,title)`); }
      catch (e) { if (e instanceof AuthError) throw e; ls.del("google-ids"); ssId = null; folderId = null; return ensureFiles(); }
      meta.sheets.forEach(s => { sheetIds[s.properties.title] = s.properties.sheetId; });
      if (!folderId) { const f = await findByProp("receipts-v1", "application/vnd.google-apps.folder"); if (f) folderId = f.id; }
      if (!folderId) {
        const f = await api(`${DRIVE}?fields=id`, { method: "POST", body: JSON.stringify({ name: C.receiptsFolder, mimeType: "application/vnd.google-apps.folder", appProperties: { [PFX]: "receipts-v1" } }) });
        folderId = f.id;
      }
      ls.set("google-ids", JSON.stringify({ ssId, folderId }));
    }
    const toRow = (kind, r) => COLS[kind].cols.map(c => r[c] === undefined || r[c] === null ? "" : String(r[c]));
    function fromRow(kind, row) {
      const o = {}; COLS[kind].cols.forEach((c, i) => { o[c] = row[i] === undefined ? "" : row[i]; });
      o.amountMinor = parseInt(o.amountMinor, 10) || Math.round(parseFloat(o.amount || "0") * 100);
      o.cadMinor = o.cadMinor === "" ? null : parseInt(o.cadMinor, 10);
      o.rateToCAD = o.rateToCAD === "" ? null : parseFloat(o.rateToCAD);
      ["id", "date", "currency", "description", "payer", "service", "notes", "receiptName", "receiptLink", "receiptId", "receiptHash"].forEach(k => { if (o[k] !== undefined) o[k] = String(o[k]); });
      return o;
    }
    async function readAll(kind) {
      const { sheet, cols } = COLS[kind];
      const r = await api(`${SHEETS}/${ssId}/values/${q(`${sheet}!A2:${colLetter(cols.length)}`)}?valueRenderOption=UNFORMATTED_VALUE`);
      return (r.values || []).map((row, i) => ({ rowNum: i + 2, rec: fromRow(kind, row) })).filter(x => x.rec.id);
    }
    const append = (sheet, rows) => api(`${SHEETS}/${ssId}/values/${q(`${sheet}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows }) });
    const audit = (action, kind, recordId, before, after) => append("Audit", [[uid(), nowIso(), "owner (signed-in Google account)", action, kind, recordId, before ? JSON.stringify(before) : "", after ? JSON.stringify(after) : ""]]).catch(() => {});

    return {
      mode: "google", AuthError,
      hasToken() { return !!token(); },
      /** Full-page redirect to Google. Nothing after this line runs. */
      beginSignIn() {
        if (!clientId) throw new Error("The Google Client ID hasn't been set up yet. Ask Arunesh to add it.");
        const state = uid(); ss.set("oauth-state", state);
        const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: "token", scope: SCOPE, include_granted_scopes: "true", state, prompt: "select_account" });
        location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
      },
      async init() { needToken(); await ensureFiles(); return true; },
      info() { return { mode: "google", label: "Google · your private Sheet", sheetUrl: ssId ? `https://docs.google.com/spreadsheets/d/${ssId}/edit` : "" }; },
      async list(kind) { return (await readAll(kind)).map(x => x.rec); },
      async save(kind, rec) {
        const all = await readAll(kind);
        const hit = all.find(x => x.rec.id === rec.id);
        const row = derived(Object.assign({}, hit ? hit.rec : {}, rec, { createdAt: hit ? hit.rec.createdAt : (rec.createdAt || nowIso()), updatedAt: nowIso() }));
        const { sheet, cols } = COLS[kind];
        if (hit) await api(`${SHEETS}/${ssId}/values/${q(`${sheet}!A${hit.rowNum}:${colLetter(cols.length)}${hit.rowNum}`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [toRow(kind, row)] }) });
        else await append(sheet, [toRow(kind, row)]);
        const check = (await readAll(kind)).find(x => x.rec.id === rec.id);
        if (!check) throw new Error("Google didn't confirm the save. Check your list before trying again.");
        await audit(hit ? "update" : "create", kind, rec.id, hit ? hit.rec : null, row);
        return { record: check.rec, created: !hit };
      },
      async bulkAdd(kind, recs) {
        const existing = new Set((await readAll(kind)).map(x => x.rec.id));
        const fresh = recs.filter(r => !existing.has(r.id)).map(r => toRow(kind, derived(Object.assign({ createdAt: nowIso() }, r, { updatedAt: nowIso() }))));
        for (let i = 0; i < fresh.length; i += 500) await append(COLS[kind].sheet, fresh.slice(i, i + 500));
        await audit("import", kind, `${fresh.length} rows`, null, null);
        return fresh.length;
      },
      async remove(kind, id) {
        const hit = (await readAll(kind)).find(x => x.rec.id === id);
        if (!hit) return;
        await api(`${SHEETS}/${ssId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheetIds[COLS[kind].sheet], dimension: "ROWS", startIndex: hit.rowNum - 1, endIndex: hit.rowNum } } }] }) });
        await audit("delete", kind, id, hit.rec, null);
      },
      uploadReceipt(file, meta, onProgress) {
        const tk = needToken();
        return new Promise((res, rej) => {
          const boundary = "b" + Math.random().toString(36).slice(2);
          const metaJson = JSON.stringify({ name: meta.name, parents: [folderId], appProperties: { [PFX]: "receipt", linkedId: meta.linkedId || "" } });
          const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`, file, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
          const x = new XMLHttpRequest();
          x.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink");
          x.setRequestHeader("Authorization", "Bearer " + tk);
          x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
          x.onload = () => {
            if (x.status === 401) return rej(new AuthError("Your Google session has ended. Tap “Reconnect Google”."));
            if (x.status < 200 || x.status >= 300) return rej(new Error("Receipt upload failed (" + x.status + ")."));
            const j = JSON.parse(x.responseText); res({ receiptId: j.id, receiptName: j.name, receiptLink: j.webViewLink || "" });
          };
          x.onerror = () => rej(new Error("Receipt upload failed. Check your internet."));
          x.send(body);
        });
      },
      async openReceipt(rec) { if (!rec.receiptLink) throw new Error("No link stored for this receipt."); window.open(rec.receiptLink, "_blank", "noopener"); },
      async trashReceipt(id) { if (id) await api(`${DRIVE}/${id}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) }); },
      async getSettings() {
        const r = await api(`${SHEETS}/${ssId}/values/${q("Settings!A2:B")}`);
        const row = (r.values || []).find(v => v[0] === "app");
        try { return row ? JSON.parse(row[1]) : {}; } catch (e) { return {}; }
      },
      async saveSettings(value) { await api(`${SHEETS}/${ssId}/values/${q("Settings!A2:B2")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["app", JSON.stringify(value)]] }) }); },
      signOut() {
        const t = ss.get("token");
        if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t), { method: "POST" }).catch(() => {});
        ss.del("token"); ss.del("token-exp");
      },
    };
  }

  root.Stores = { LocalStore, GoogleStore, AuthError, uid, consumeRedirect, redirectUri };
})(self);
