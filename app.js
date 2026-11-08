// Calibration Management System, mobile app: the device side of Mobile Devices > Send Tools to Mobile.
// Open a session file, log in with a Mobile PIN, browse the tools, calibrate
// them (or add custom entries), and send the results back to the desktop.
//
// - The file is kept on the phone still locked. After the PIN, the inspector
//   stays logged in until midnight; Lock, Switch User, midnight or the file
//   expiring asks for the PIN again.
// - Every entry is saved on the phone the moment it's saved (locked with the
//   file's key), so a refresh, Lock or flat battery never loses work.
// - Send Results always carries every entry so far; the desktop adds each one
//   once, so a lost email can just be sent again. Sent entries can't be
//   changed here (corrections are made at the desktop).
"use strict";

(() => {
  const STORE_FILE = "calcheck.file";        // the locked file, as emailed
  const STORE_USER = "calcheck.lastUser";    // the name picked last time
  const STORE_TRIES = "calcheck.tries";      // wrong PINs in a row, and when
  const STORE_WORK = "calcheck.work";        // the entries made here (locked)
  const STORE_WORK_INFO = "calcheck.workInfo";   // just {session, total, unsent}: readable before the PIN
  const FREE_TRIES = 5, WAIT_SECONDS = 60;
  const APP_VERSION = "a30";                  // (shown on the login screen; the same as VERSION in sw.js)
  const STATUSES = ["In Service", "Reference Only", "Damaged", "Removed from Service"];

  const app = document.getElementById("app");
  const state = { header: null, data: null, user: null, key: null, until: 0, work: null, expired: false,
                  tab: "due", search: "", category: "", formHash: null, formDirty: false };

  // ---------- storage (private mode or a full phone can refuse it) ----------
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function forget(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing kept */ } }

  // ---------- building the screen (text is always set as text, never as HTML) ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    tool: ["M4 20L14 10", "M14 4v6h6", "M10 4h4M20 10v4"],
    file: ["M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z", "M14 3v5h5"],
    search: ["M20 20l-3.5-3.5", "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14"],
    back: ["M19 12H5M11 6l-6 6 6 6"],
    chev: ["M9 6l6 6-6 6"],
    clock: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M12 7v5l3 2"],
    done: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M8 12.5l2.5 2.5L16 9.5"],
    grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    mail: ["M3 5h18v14H3z", "M3 7l9 6 9-6"],
    light: ["M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
    dark: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
    scan: ["M4 8V6a2 2 0 0 1 2-2h2", "M16 4h2a2 2 0 0 1 2 2v2", "M20 16v2a2 2 0 0 1-2 2h-2", "M8 20H6a2 2 0 0 1-2-2v-2",
           "M8 9v6", "M11 9v6", "M14 9v6", "M17 9v6"],
    close: ["M6 6l12 12M18 6L6 18"],
    torch: ["M8 3h8l-1 6H9z", "M9 9h6v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z", "M12 13v2"],
    camera: ["M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
             "M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7"],
  };
  function icon(name, size = 22) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
                                          "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }))
      svg.setAttribute(k, v);
    for (const d of ICONS[name]) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  function show(...children) {
    app.replaceChildren(...children);
    window.scrollTo(0, 0);
  }

  // 'Type at least 3 decimal places (e.g. 2.000)' for a reading shorter than its range
  function shortHint(range, needed) {
    return `Type at least ${needed} decimal place${needed === 1 ? "" : "s"} (e.g. ${Rules.parseMeasurement(range).toFixed(needed)})`;
  }

  function toast(text) {
    const t = h("div", { class: "toast", role: "status" }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  function plural(n, word, many = word + "s") {
    return `${n} ${n === 1 ? word : many}`;
  }

  function localDay(isoMoment) {
    const d = new Date(isoMoment);
    return isNaN(d) ? "" : Dates.display(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  function timeText(isoMoment) {
    const d = new Date(isoMoment);
    return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d+Z$/, "Z");
  }

  // ---------- the work done on this device ----------
  function workInfo() {
    try { return JSON.parse(load(STORE_WORK_INFO) || "null"); } catch (e) { return null; }
  }

  // Unsent entries kept for a session (readable without the PIN: counts only)
  function unsentFor(session) {
    const info = workInfo();
    return info && info.session === session ? info.unsent : 0;
  }

  async function loadWork() {
    const text = load(STORE_WORK);
    state.work = { entries: [], sends: [] };
    if (!text) return;
    try {
      state.work = await CalCheck.unlockWork(state.key, state.header.session, text);
    } catch (e) {
      // From an older file whose results were all sent (a file with unsent
      // results can't be replaced): start afresh
    }
  }

  async function saveWork() {
    const unsent = state.work.entries.filter(e => !e.sent_at).length;
    const text = await CalCheck.lockWork(state.key, state.header.session, state.work);
    const ok = save(STORE_WORK, text) &&
      save(STORE_WORK_INFO, JSON.stringify({ session: state.header.session, total: state.work.entries.length, unsent }));
    if (!ok) alert("The device wouldn't save this (is it full?). Free some space and save again.");
    return ok;
  }

  function entriesFor(toolId) {
    return state.work.entries.filter(e => e.tool_id === toolId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.saved_at.localeCompare(a.saved_at));
  }

  // A tool as it stands with this device's entries: the newest entry decides
  // its due date (as on the desktop), a custom entry can change its status.
  // A tool split into items: each item's own (currentItem); the tool is as due
  // as its soonest item sent here (any item, for one only to look up)
  function current(tool) {
    const mine = entriesFor(tool.tool_id);
    const latest = mine.find(e => !tool.last_date || e.date >= tool.last_date);
    const statusEntry = state.work.entries.filter(e => e.tool_id === tool.tool_id && e.kind === "custom")
      .sort((a, b) => b.saved_at.localeCompare(a.saved_at))[0];
    const now = {
      ...tool,
      due_date: latest ? latest.due_date : tool.due_date,
      last_date: latest ? latest.date : tool.last_date,
      status: statusEntry ? statusEntry.status : tool.status,
      done: mine.length > 0,
    };
    if (tool.items) {
      now.items = tool.items.map(i => currentItem(tool, i));
      const counted = now.items.some(i => i.sent) ? now.items.filter(i => i.sent) : now.items;
      const dated = counted.filter(i => i.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
      now.due_date = dated.length ? dated[0].due_date : "";
    }
    return now;
  }

  // ---------- tools split into items (GMS001's blocks) ----------
  // Each item has its own ranges, due date and calibrations; those sent here
  // ("sent") can be calibrated, one at a time or the whole tool together
  function sentItems(tool) {
    return (tool.items || []).filter(i => i.sent);
  }

  function itemOf(tool, id) {
    return (tool.items || []).find(i => String(i.id) === String(id));
  }

  // Whether an entry is for an item: a calibration with a range of it, a custom
  // entry for it - or for the whole tool (no item)
  function entryCovers(e, itemId) {
    return e.kind === "custom" ? !e.item_id || e.item_id === itemId : e.ranges.some(r => r.item_id === itemId);
  }

  function currentItem(tool, item) {
    const mine = entriesFor(tool.tool_id).filter(e => entryCovers(e, item.id));
    const latest = mine.find(e => !item.last_date || e.date >= item.last_date);
    const range = latest && latest.kind === "measurement" ? latest.ranges.find(r => r.item_id === item.id) : null;
    return {
      ...item,
      due_date: !latest ? item.due_date : range ? range.due_date || "" : latest.due_date,
      last_date: latest ? latest.date : item.last_date,
      done: mine.some(e => e.kind === "measurement"),
    };
  }

  // The items an entry is for, by name ("" for the whole tool / a tool not split)
  function entryItemNames(e) {
    const tool = state.data.tools.find(t => t.tool_id === e.tool_id);
    if (!tool || !tool.items) return "";
    if (e.kind === "custom") return e.item_id ? (itemOf(tool, e.item_id) || { name: "" }).name : "Whole tool";
    return [...new Set(e.ranges.map(r => (itemOf(tool, r.item_id) || { name: "" }).name))].filter(Boolean).join(", ");
  }

  function itemHash(prefix, tool, item) {
    return `#/${prefix}/${encodeURIComponent(tool.tool_id)}${item ? `/item/${item === "all" ? "all" : item.id}` : ""}`;
  }

  function canChange(entry) {
    return !entry.sent_at && entry.by === state.user.username && !state.expired;
  }

  function entryResult(e) {
    if (e.kind === "custom") return "Entry";
    return e.ranges.some(r => r.result === "fail") ? "Fail" : "Pass";
  }

  // ---------- opening the file and logging in ----------
  function storedHeader() {
    const text = load(STORE_FILE);
    if (!text) return null;
    try { return CalCheck.readHeader(text); } catch (e) { forget(STORE_FILE); return null; }
  }

  function removeFile() {
    forget(STORE_FILE);
    forget(STORE_TRIES);
    forget(STORE_WORK);
    forget(STORE_WORK_INFO);
    lock();
  }

  function confirmRemove(header) {
    const unsent = unsentFor(header.session);
    return confirm(unsent
      ? `${plural(unsent, "result")} on this device haven't been sent and will be lost.\n\nRemove the file and the results anyway?`
      : "Remove the session file (and the results already sent) from this device?");
  }

  // ---------- staying logged in until midnight ----------
  // The file's key is kept in the browser's own database as a key the
  // browser can use but never hand out, with who unlocked it and until when.
  function idb(mode, work) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("calcheck", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("login");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("login", mode);
        const request = work(tx.objectStore("login"));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }

  function midnightTonight() {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function rememberLogin() {
    return idb("readwrite", s => s.put({ key: state.key, session: state.header.session, username: state.user.username,
                                         until: state.until }, "current")).catch(() => { /* asks for the PIN next time */ });
  }

  function forgetLogin() {
    return idb("readwrite", s => s.delete("current")).catch(() => { /* nothing kept */ });
  }

  // Logs back in without the PIN if this file was unlocked earlier today.
  async function resumeLogin(header) {
    let saved;
    try { saved = await idb("readonly", s => s.get("current")); } catch (e) { return false; }
    const user = saved && header.inspectors.find(i => i.username === saved.username);
    if (!user || saved.session !== header.session || Date.now() >= saved.until) {
      if (saved) forgetLogin();
      return false;
    }
    try { state.data = await CalCheck.reopen(header, saved.key); } catch (e) { forgetLogin(); return false; }
    Object.assign(state, { header, user, key: saved.key, until: saved.until });
    applyDueColours();
    await loadWork();
    return true;
  }

  function loggedInTooLong() {
    return state.data && Date.now() >= state.until;
  }

  function waitLeft() {
    let tries;
    try { tries = JSON.parse(load(STORE_TRIES) || "null"); } catch (e) { tries = null; }
    if (!tries || tries.count < FREE_TRIES) return 0;
    return Math.max(0, Math.ceil((tries.at + WAIT_SECONDS * 1000 - Date.now()) / 1000));
  }

  function wrongPin() {
    let tries;
    try { tries = JSON.parse(load(STORE_TRIES) || "null"); } catch (e) { tries = null; }
    const count = (tries ? tries.count : 0) + 1;
    save(STORE_TRIES, JSON.stringify({ count, at: Date.now() }));
  }

  function chooseFile(after) {
    const input = h("input", { type: "file", class: "hidden-input", "aria-hidden": "true", tabindex: "-1" });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      file.text().then(text => {
        try {
          const header = CalCheck.readHeader(text);
          const old = storedHeader();
          if (old && old.session !== header.session && unsentFor(old.session))
            throw new Error(`${plural(unsentFor(old.session), "result")} from the file on this device haven't been sent. ` +
                            "Log in and use Send Results first (or remove that file to throw them away).");
          if (CalCheck.isExpired(header)) throw new Error(`That file expired on ${Dates.displayMoment(header.expires)}. Ask for a new one.`);
          if (!save(STORE_FILE, text)) throw new Error("The device wouldn't keep the file (is it in private browsing, or full?).");
          forget(STORE_TRIES);
          forgetLogin();
          after(null);
        } catch (e) {
          after(e.message);
        }
      }, () => after("The file couldn't be read."));
    });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  }

  // The blue band on the open and login screens: the app's white caliper on
  // the left, its name stacked on the right (as on the desktop's login)
  function brandHero(subtitle) {
    return h("div", { class: "hero" },
      h("div", { class: "brand" },
        h("img", { src: "mobile-logo.png", alt: "", class: "brand-logo" }),
        h("h1", { class: "brand-name" }, h("span", {}, "Calibration"), h("span", {}, "Management"), h("span", {}, "System"))),
      subtitle ? h("p", {}, subtitle) : null);
  }

  // ---------- Display: Light / Dark (theme.js) ----------
  // On the open and login screens: both to pick from
  function displayPicker() {
    const box = h("div", { class: "seg", role: "group", "aria-label": "Display" });
    function fill() {
      box.replaceChildren(...Theme.CHOICES.map(c => h("button", {
        type: "button", "aria-pressed": String(Theme.choice() === c), onclick: () => { Theme.set(c); fill(); } },
        icon(c, 16), Theme.LABELS[c])));
    }
    fill();
    // Samsung Internet's own Dark mode darkens every site, whatever is chosen
    // here (the page can't stop it): say so, in that browser only
    const samsung = /SamsungBrowser/i.test(navigator.userAgent);
    return [h("div", { class: "display-line" }, h("span", {}, "Display"), box),
            samsung ? h("p", { class: "display-note" },
              "Using Samsung Internet? Turn off its own Dark mode (menu ☰) so this setting works.") : null];
  }

  // In the top bar once logged in: tap to switch
  function displayButton() {
    const button = h("button", { class: "icon-btn" });
    function showChoice() {
      const c = Theme.choice();
      button.replaceChildren(icon(c, 20));
      button.setAttribute("aria-label", `Display: ${Theme.LABELS[c]} (tap to change)`);
    }
    button.addEventListener("click", () => {
      const next = Theme.CHOICES[(Theme.CHOICES.indexOf(Theme.choice()) + 1) % Theme.CHOICES.length];
      Theme.set(next);
      showChoice();
      toast(`Display: ${Theme.LABELS[next]}`);
    });
    showChoice();
    return button;
  }

  function versionLine() {
    return h("p", { class: "version" }, `Version ${APP_VERSION}`);
  }

  function openScreen(problem) {
    const header = storedHeader();
    if (header && CalCheck.isExpired(header) && !unsentFor(header.session)) {
      removeFile();
      return openScreen(`The session file expired on ${Dates.displayMoment(header.expires)} and was removed from this device. Ask for a new one.`);
    }
    if (header) return loginScreen(header, problem);

    show(h("div", { class: "screen" },
      brandHero("Works offline · nothing is kept until you open a session file"),
      h("div", { class: "panel" },
        h("h2", {}, "Open the session file you were emailed"),
        h("p", { class: "small" }, "Save the email's attachment to your device (Files or Downloads) first, then pick it here."),
        h("button", { class: "pick-file", onclick: () => chooseFile(openScreen) }, icon("file", 20), "Choose File"),
        problem && h("div", { class: "note bad", role: "alert" }, problem)),
      displayPicker(),
      versionLine()));
  }

  function loginScreen(header, problem) {
    const last = load(STORE_USER);
    const expired = CalCheck.isExpired(header);
    const unsent = unsentFor(header.session);
    const select = h("select", { id: "who" },
      header.inspectors.length > 1 && h("option", { value: "" }, "Choose your name"),
      header.inspectors.map(i => h("option", { value: i.username, selected: i.username === last }, i.name)));
    const pin = h("input", { id: "pin", type: "password", inputmode: "numeric", autocomplete: "off", pattern: "[0-9]*", maxlength: "12" });
    const message = h("div", { role: "alert" });
    const go = h("button", { class: "btn", type: "submit" }, "Unlock");

    function say(text) {
      message.replaceChildren(text ? h("div", { class: "note bad" }, text) : "");
    }
    say(problem);

    const form = h("form", { class: "panel", onsubmit: async e => {
      e.preventDefault();
      const wait = waitLeft();
      if (wait) return say(`Too many wrong PINs. Try again in ${wait} seconds.`);
      if (!select.value) return say("Choose your name first.");
      if (!pin.value) return say("Enter your Mobile PIN.");
      go.disabled = true;
      go.textContent = "Unlocking...";
      try {
        const { data, key } = await CalCheck.unlock(header, select.value, pin.value);
        forget(STORE_TRIES);
        save(STORE_USER, select.value);
        Object.assign(state, { header, data, key, until: midnightTonight(),
                               user: header.inspectors.find(i => i.username === select.value) });
        applyDueColours();
        await loadWork();
        await rememberLogin();
        if (!location.hash.startsWith("#/")) location.hash = "#/due";
        route();
      } catch (err) {
        if (err.message === "Wrong PIN.") wrongPin();
        pin.value = "";
        say(err.message);
        go.disabled = false;
        go.textContent = "Unlock";
      }
    } },
      expired
        ? h("div", { class: "note bad" },
            h("b", {}, "This session file has expired"),
            h("span", {}, `${plural(unsent, "result")} on this device haven't been sent. Log in and use Send Results.`))
        : h("div", { class: "note ok" },
            h("b", {}, "Session file on this device"),
            h("span", {}, `${plural(header.tool_count, "tool")} · sent by ${header.checked_out_by}`),
            h("span", { class: "small" }, `Expires ${Dates.displayMoment(header.expires)} · ${header.session}`),
            unsent ? h("span", { class: "small" }, `${plural(unsent, "result")} not sent yet`) : null),
      h("label", { class: "field", for: "who" }, "Your name", select),
      h("label", { class: "field", for: "pin" }, "Mobile PIN", pin),
      message,
      go,
      h("button", { type: "button", class: "link-btn", onclick: () => chooseFile(err => err ? say(err) : openScreen()) },
        "Open a different file"),
      h("button", { type: "button", class: "link-btn danger", onclick: () => {
        if (confirmRemove(header)) { removeFile(); openScreen(); }
      } }, "Remove the file from this device"));

    show(h("div", { class: "screen" },
      brandHero("Log in with your Mobile PIN"),
      form,
      displayPicker(),
      versionLine()));
    (select.value ? pin : select).focus();
  }

  function lock() {
    forgetLogin();
    applyDueColours();          // (back to the built-in colours)
    Object.assign(state, { header: null, data: null, user: null, key: null, work: null, until: 0, expired: false,
                           search: "", category: "", formHash: null, formDirty: false });
  }

  function lockAndLeave(switching) {
    if (switching) forget(STORE_USER);           // (the next person picks their own name)
    lock();
    history.replaceState(null, "", location.pathname);
    openScreen();
  }

  // ---------- the tools ----------
  function rules() {
    return state.data.due_rules || { overdue_after: 14, due_soon: 14 };
  }

  // The PC's due-date colours (Admin Settings > Due Colours), when changed
  // from the built-in ones: { red: { dot, text, bg }, ... }. See app.css.
  function applyDueColours() {
    // (the tool lists' dots: off when Admin Settings > Due Indicators says so)
    document.documentElement.classList.toggle("no-dots", !!state.data && state.data.due_dots === false);
    Dates.setFormat(state.data && state.data.date_format);    // (dates as on the PC's screen)
    const root = document.documentElement.style;
    const colours = (state.data && state.data.due_colours) || {};
    for (const sev of ["red", "yellow", "green", "none"]) {
      const c = colours[sev];
      const set = (name, value) => value ? root.setProperty(name, value) : root.removeProperty(name);
      set(`--due-${sev}`, c && c.dot);
      set(`--due-${sev}-text`, c && c.text);
      set(`--due-${sev}-bg`, c && c.bg);
      if (sev === "yellow") set("--due-yellow-card-text", c && c.text);
    }
  }

  function matches(tool) {
    const text = state.search.trim().toLowerCase();
    return !text || tool.tool_id.toLowerCase().includes(text) || tool.name.toLowerCase().includes(text);
  }

  function go(hash) {
    location.hash = hash;
  }

  function toolRow(tool, side) {
    const sev = Dates.severity(tool.due_date, rules());
    return h("button", { class: "row", onclick: () => go(`#/tool/${encodeURIComponent(tool.tool_id)}`) },
      h("span", { class: `dot ${sev}`, "aria-label": sev === "none" ? "No due date" : `${sev} dot` }),
      h("span", { class: "row-main" }, h("span", { class: "row-id" }, tool.tool_id), h("span", { class: "row-name" }, tool.name)),
      h("span", { class: "row-side" }, side),
      h("span", { class: "chev" }, icon("chev", 16)));
  }

  // An item of a split tool, under its tool's row (narrower, so it reads as part of it)
  // (to: where a tap goes - the item's page, unless said; to also makes it full width: a list of items alone)
  function itemRow(tool, item, side, to) {
    const sev = Dates.severity(item.due_date, rules());
    return h("button", { class: to ? "row item-pick" : "row sub", onclick: () => go(to || itemHash("tool", tool, item)) },
      h("span", { class: `dot ${sev}`, "aria-label": sev === "none" ? "No due date" : `${sev} dot` }),
      h("span", { class: "row-main" }, h("span", { class: "row-id" }, item.name),
        h("span", { class: "row-name" }, item.interval ? `Every ${item.interval}` : tool.tool_id)),
      h("span", { class: "row-side" }, side),
      h("span", { class: "chev" }, icon("chev", 16)));
  }

  function sessionStrip() {
    const entries = state.work.entries;
    const unsent = entries.filter(e => !e.sent_at).length;
    return [
      h("div", { class: "session" },
        h("span", {}, h("b", {}, state.user.name),
          state.expired ? " · file expired: send your results" : ` · expires ${Dates.displayMoment(state.header.expires)}`),
        h("button", { onclick: () => lockAndLeave(true) }, "Switch User"),
        h("button", { onclick: () => lockAndLeave(false) }, "Lock")),
      entries.length ? h("button", { class: "send-strip", onclick: () => go("#/send") },
        h("span", {}, `${plural(entries.length, "entry", "entries")} on this device`,
          unsent ? h("b", { class: "unsent" }, ` · ${unsent} not sent`) : " · all sent"),
        h("span", { class: "send-link" }, "Send Results", icon("chev", 14))) : null,
    ];
  }

  function searchBox(placeholder, refill) {
    const input = h("input", { type: "search", placeholder, "aria-label": "Search", value: state.search });
    input.addEventListener("input", () => { state.search = input.value; refill(); });
    // (at its end: Scan a Label - a tool's calibration label, read by the camera)
    const scan = h("button", { type: "button", class: "scan", "aria-label": "Scan a label", onclick: e => {
      e.preventDefault();
      go("#/scan");
    } }, icon("scan", 24));
    return h("label", { class: "search" }, icon("search", 18), input, scan);
  }

  function tabBar() {
    const tab = (name, label, iconName) => h("button", {
      class: "tab", "aria-current": state.tab === name ? "page" : null,
      onclick: () => go(`#/${name}`) }, icon(iconName), label);
    return h("nav", { class: "tabs", "aria-label": "Tabs" },
      tab("due", "Due", "clock"), tab("completed", "Completed", "done"), tab("all", "All", "grid"));
  }

  function dueScreen() {
    const list = h("main", { class: "list" });
    const chips = h("div", { class: "chips" });
    const due = state.data.tools.map(current)
      .filter(t => ["red", "yellow"].includes(Dates.severity(t.due_date, rules())))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));

    // (a split tool: its items sent here that are due, each under it)
    const dueItems = t => sentItems(t).filter(i => ["red", "yellow"].includes(Dates.severity(i.due_date, rules())));
    const when = due => [h("b", { class: Dates.severity(due, rules()) }, Dates.whenText(due)), `Due ${Dates.display(due)}`];

    function fill() {
      const shown = due.filter(matches);
      const units = shown.flatMap(t => t.items ? dueItems(t) : [t]);         // (each item counts)
      const count = sev => units.filter(u => Dates.severity(u.due_date, rules()) === sev).length;
      chips.replaceChildren(
        h("span", { class: "chip red" }, Dates.overdueCountText(count("red"), rules())),
        h("span", { class: "chip yellow" }, Dates.dueSoonCountText(count("yellow"), rules())));
      list.replaceChildren(...shown.flatMap(t => [toolRow(t, when(t.due_date)),
                                                  ...(t.items ? dueItems(t).map(i => itemRow(t, i, when(i.due_date))) : [])]));
      if (!shown.length) list.append(h("p", { class: "empty" }, state.search ? "No tools match your search" : "Nothing in this file is due or overdue"));
    }
    fill();
    show(h("div", { class: "screen" },
      h("header", { class: "bar" }, h("div", { class: "bar-row" }, h("h1", {}, "Calibrations Due"), displayButton()),
        searchBox("Search tool ID or description", fill)),
      sessionStrip(), chips, list, tabBar()));
  }

  function allScreen() {
    const list = h("main", { class: "list" });
    // (and the tools to look up only, marked so)
    const tools = state.data.tools.map(current).concat((state.data.view_tools || []).map(t => ({ ...t, viewOnly: true })));
    const present = new Set(tools.map(t => t.category));
    const categories = (state.data.categories || []).filter(c => present.has(c));
    for (const c of present) if (!categories.includes(c)) categories.push(c);
    const filters = h("div", { class: "chips" });

    function fill() {
      filters.replaceChildren(...["", ...categories].map(c => h("button", {
        class: "filter", "aria-pressed": state.category === c ? "true" : "false",
        onclick: () => { state.category = c; fill(); } }, c || "All")));
      list.replaceChildren();
      for (const c of categories) {
        if (state.category && state.category !== c) continue;
        const shown = tools.filter(t => t.category === c && matches(t))
          .sort((a, b) => a.tool_id.localeCompare(b.tool_id, undefined, { numeric: true }));
        if (!shown.length) continue;
        list.append(h("h2", { class: "group" }, `${c || "No category"} · ${shown.length}`),
                    ...shown.flatMap(t => [toolRow(t, t.viewOnly ? [h("span", { class: "view-mark" }, "View only"), t.status]
                                                                 : [t.done ? h("b", { class: "done-mark" }, "Done") : null, t.status]),
                      // (a split tool sent here: its items sent, under it)
                      ...(t.viewOnly ? [] : sentItems(t).map(i => itemRow(t, i, [i.done ? h("b", { class: "done-mark" }, "Done") : null,
                                                                                 i.due_date ? `Due ${Dates.display(i.due_date)}` : "No due date"])))]));
      }
      if (!list.children.length) list.append(h("p", { class: "empty" }, "No tools match your search"));
    }
    fill();
    show(h("div", { class: "screen" },
      h("header", { class: "bar" }, h("div", { class: "bar-row" }, h("h1", {}, "All Tools"), displayButton()),
        searchBox(`Search the ${tools.length} tools`, fill)),
      sessionStrip(), filters, list, tabBar()));
    fitBarHeight();
  }

  // The blue bar's height, for the All tab's category headings: they stick just under it
  // (the bar is stuck at the top) - measured as a screen opens and when the phone turns
  function fitBarHeight() {
    const bar = document.querySelector(".screen > .bar");
    if (bar) document.documentElement.style.setProperty("--bar-height", `${bar.offsetHeight}px`);
  }

  function entryLine(e, { withTool = false } = {}) {
    const tool = state.data.tools.find(t => t.tool_id === e.tool_id) || { name: "" };
    const result = entryResult(e);
    const items = entryItemNames(e);            // (a split tool: which items)
    const what = [items, e.kind === "custom" ? e.note.split("\n")[0] : plural(e.ranges.length, "range")].filter(Boolean).join(" · ");
    return h("button", { class: "entry-row", onclick: () => go(`#/entry/${e.id}`) },
      h("span", { class: "entry-top" },
        h("span", { class: "row-id" }, withTool ? e.tool_id : Dates.display(e.date)),
        h("span", { class: `result ${result}` }, result)),
      h("span", { class: "row-name" }, withTool ? (e.kind === "custom" || items ? `${tool.name} – ${what}` : tool.name) : what),
      h("span", { class: "small" },
        [withTool ? Dates.display(e.date) : null, `${e.by_name} at ${timeText(e.saved_at)}`].filter(Boolean).join(" · "),
        e.sent_at ? h("span", { class: "tag sent" }, "Sent") : h("span", { class: "tag unsent" }, "Not sent")));
  }

  function completedScreen() {
    const list = h("main", { class: "list" });
    const summary = h("p", { class: "summary" });
    const all = [...state.work.entries].sort((a, b) => b.saved_at.localeCompare(a.saved_at));

    function fill() {
      const text = state.search.trim().toLowerCase();
      const shown = all.filter(e => !text || e.tool_id.toLowerCase().includes(text) || e.by_name.toLowerCase().includes(text) ||
                                    (state.data.tools.find(t => t.tool_id === e.tool_id) || { name: "" }).name.toLowerCase().includes(text));
      const failed = all.filter(e => entryResult(e) === "Fail").length;
      const unsent = all.filter(e => !e.sent_at).length;
      summary.replaceChildren(`On this device · ${plural(all.length, "entry", "entries")}`,
        failed ? h("span", { class: "fail-text" }, ` · ${failed} failed`) : "",
        unsent ? ` · ${unsent} not sent` : (all.length ? " · all sent" : ""));
      list.replaceChildren(...shown.map(e => entryLine(e, { withTool: true })));
      if (!shown.length) list.append(h("p", { class: "empty" }, all.length ? "No entries match your search" : "Nothing calibrated on this device yet"));
    }
    fill();
    show(h("div", { class: "screen" },
      h("header", { class: "bar" }, h("div", { class: "bar-row" }, h("h1", {}, "Completed"), displayButton()),
        searchBox("Search tool or inspector", fill)),
      sessionStrip(), summary, list, tabBar()));
  }

  function backButton(fallback) {
    return h("button", { class: "icon-btn plain", "aria-label": "Back", onclick: () => {
      if (history.length > 1) history.back(); else go(fallback);
    } }, icon("back"));
  }

  // A tool to look up only: in the file's view_tools (Send Tools to Mobile >
  // Every tool to look up) - its details and last calibrations, never calibrated here
  function viewTool(toolId) {
    return (state.data.view_tools || []).find(t => t.tool_id === toolId);
  }

  function toolScreen(toolId, itemId) {
    const original = state.data.tools.find(t => t.tool_id === toolId) || viewTool(toolId);
    if (!original) { go("#/due"); return; }
    const viewOnly = !state.data.tools.includes(original);
    const tool = current(original);
    const item = itemId !== null && itemId !== undefined ? itemOf(tool, itemId) : null;
    if (itemId && !item) { go(itemHash("tool", tool)); return; }
    if (item) return itemScreen(tool, item, viewOnly);
    const sev = Dates.severity(tool.due_date, rules());
    const fact = (label, value) => value ? h("div", { class: "fact" }, h("span", {}, label), h("span", {}, value)) : null;
    const mine = entriesFor(toolId);
    const message = h("div", { role: "alert" });
    const itemName = id => (itemOf(tool, id) || { name: "" }).name;

    show(h("div", { class: "screen" },
      h("header", { class: "bar" },
        backButton(`#/${state.tab}`),
        h("div", { class: "tool-head" },
          h("div", { class: "bar-row" }, h("h1", {}, tool.tool_id), h("span", { class: "badge" }, tool.status)),
          h("p", {}, tool.name))),
      h("main", { class: viewOnly ? "body" : "body with-actions" },
        message,
        viewOnly ? h("div", { class: "note info" }, h("b", {}, "View only"),
          `Not sent to you to calibrate. As it was on ${Dates.display(state.data.created.slice(0, 10))}, when this file was made.`) : null,
        h("section", { class: `due-card ${sev}` }, h("span", { class: `dot ${sev}` }),
          tool.due_date ? h("span", {}, h("b", {}, `Due ${Dates.display(tool.due_date)}`), ` · ${Dates.whenText(tool.due_date).replace(/^Due /, "")}`)
                        : h("span", {}, "No due date")),
        mine.length ? [h("h2", {}, "On this device"), h("section", { class: "card entries" }, mine.map(e => entryLine(e)))] : null,
        h("section", { class: "card facts" },
          // (the tool fields as laid out on the PC: Admin Settings > Tool Fields)
          tool.fields ? tool.fields.map(f => fact(f.label, f.value)) : [
            fact("Location / Technician", tool.location),
            fact("Interval", tool.interval),
            fact("Manufacturer / Model", [tool.manufacturer, tool.model].filter(Boolean).join(" ")),
            fact("Serial", tool.serial),
            fact(tool.deviation_label || "Calibration Tolerance", tool.deviation),
            fact("Environment", tool.parameter)],
          fact("Category", tool.category),
          fact("Last calibrated", Dates.display(tool.last_date))),
        // (a split tool: its items, each with its own due date - tap one for its page)
        tool.items ? [h("h2", {}, `Items · ${tool.items.length}`), h("section", { class: "card entries" }, tool.items.map(i => {
          const isev = Dates.severity(i.due_date, rules());
          return h("button", { class: "entry-row item-line", onclick: () => go(itemHash("tool", tool, i)) },
            h("span", { class: "entry-top" }, h("span", { class: "row-id" }, h("span", { class: `dot ${isev}` }), " ", i.name),
              h("span", { class: "small" }, viewOnly || i.sent ? (i.done ? "Done" : "") : "Not sent to you")),
            h("span", { class: "row-name" }, [i.due_date ? `Due ${Dates.display(i.due_date)}` : "No due date",
                                              i.interval ? `every ${i.interval}` : ""].filter(Boolean).join(" · ")));
        }))] : null,
        rangesCard(tool.ranges, itemName),
        historyCard(tool.history)),
      state.expired || viewOnly ? null : h("div", { class: "actions" },
        h("button", { class: "btn secondary", onclick: () => go(`#/custom/${encodeURIComponent(toolId)}`) }, "Custom Entry"),
        calibrateAction(tool, mine, message))));
  }

  // A tool's ranges (a split tool's: under each item's name) and its last calibrations
  function rangesCard(ranges, itemName) {
    let last = null;
    return [h("h2", {}, "Ranges"),
      h("section", { class: "card" }, ranges.length
        ? ranges.flatMap((r, i) => {
            const heading = r.item !== undefined && r.item !== last ? h("div", { class: "line item-heading" }, itemName(r.item)) : null;
            last = r.item;
            return [heading, h("div", { class: "line" },
              h("span", { class: "line-main" }, h("span", {}, r.range || `Range ${i + 1}`), h("span", {}, r.standard ? `Standard: ${r.shown || r.standard}` : "No standard set")))];
          })
        : h("p", { class: "empty" }, "No ranges set up for this tool"))];
  }

  function historyCard(history) {
    return [h("h2", {}, "Calibration history"),
      h("section", { class: "card" }, history.length
        ? history.map(e => h("div", { class: "line" },
            h("span", { class: "line-main" },
              h("span", {}, Dates.display(e.date)),
              h("span", {}, [e.items ? (e.items.join(", ") || "Whole tool") : "",
                             e.kind === "custom" ? e.remarks || "Custom entry" : plural(e.ranges, "range"), e.by, e.cal_id].filter(Boolean).join(" · "))),
            h("span", { class: `result ${e.result}` }, e.result)))
        : h("p", { class: "empty" }, "Not calibrated yet"))];
  }

  // An item of a split tool: its due date, ranges and calibrations; calibrated on its own
  function itemScreen(tool, item, viewOnly) {
    const sev = Dates.severity(item.due_date, rules());
    const fact = (label, value) => value ? h("div", { class: "fact" }, h("span", {}, label), h("span", {}, value)) : null;
    const mine = entriesFor(tool.tool_id).filter(e => entryCovers(e, item.id));
    const message = h("div", { role: "alert" });
    const canDo = !viewOnly && item.sent;
    show(h("div", { class: "screen" },
      h("header", { class: "bar" },
        backButton(itemHash("tool", tool)),
        h("div", { class: "tool-head" },
          h("div", { class: "bar-row" }, h("h1", {}, item.name), h("span", { class: "badge" }, tool.status)),
          h("p", {}, `${tool.tool_id} · ${tool.name}`))),
      h("main", { class: canDo && !state.expired ? "body with-actions" : "body" },
        message,
        canDo ? null : h("div", { class: "note info" }, h("b", {}, "View only"),
          viewOnly ? `Not sent to you to calibrate. As it was on ${Dates.display(state.data.created.slice(0, 10))}, when this file was made.`
                   : `This item of ${tool.tool_id} wasn't sent to you to calibrate.`),
        h("section", { class: `due-card ${sev}` }, h("span", { class: `dot ${sev}` }),
          item.due_date ? h("span", {}, h("b", {}, `Due ${Dates.display(item.due_date)}`), ` · ${Dates.whenText(item.due_date).replace(/^Due /, "")}`)
                        : h("span", {}, "No due date")),
        mine.length ? [h("h2", {}, "On this device"), h("section", { class: "card entries" }, mine.map(e => entryLine(e)))] : null,
        h("section", { class: "card facts" },
          fact("Item of", `${tool.tool_id} · ${tool.name}`), fact("Interval", item.interval),
          fact(tool.deviation_label || "Calibration Tolerance", tool.deviation),
          fact("Last calibrated", Dates.display(item.last_date))),
        rangesCard(tool.ranges.filter(r => r.item === item.id), () => item.name),
        historyCard(tool.history.filter(e => !e.items || !e.items.length || e.items.includes(item.name)))),
      !canDo || state.expired ? null : h("div", { class: "actions" },
        h("button", { class: "btn secondary", onclick: () => go(itemHash("custom", tool, item)) }, "Custom Entry"),
        calibrateAction(tool, mine, message, item))));
  }

  // Calibrate a split tool: which item - or the whole tool, every item sent here, together
  function pickScreen(original) {
    const tool = current(original);
    const items = sentItems(tool);
    show(h("div", { class: "screen" },
      formHeader(`Calibrate ${tool.tool_id}`, "Which item?"),
      h("main", { class: "list" },
        // (each item's row: straight to calibrating it)
        items.map(i => itemRow(tool, i, [i.done ? h("b", { class: "done-mark" }, "Done") : null,
                                         i.due_date ? `Due ${Dates.display(i.due_date)}` : "No due date"],
                               itemHash("cal", tool, i))),
        items.length > 1 ? h("button", { class: "btn wide", onclick: () => go(itemHash("cal", tool, "all")) },
          `Whole tool · ${plural(items.length, "item")}`) : null)));
  }

  // Calibrate - or, once this device has a calibration for the tool, a green
  // "Calibration Complete" (so it isn't calibrated twice by mistake). From the
  // All tab it can be done again, after a check. A split tool: which item
  // (pickScreen); an item: its own
  function calibrateAction(tool, mine, message, item) {
    const done = tool.items && !item ? null : mine.find(e => e.kind === "measurement");
    if (done && state.tab !== "all")
      return h("div", { class: "complete", role: "status" }, "✓ Calibration Complete");
    if (tool.items && !item)
      return sentItems(tool).length ? h("button", { class: "btn", onclick: () => go(itemHash("pick", tool)) }, "Calibrate") : null;
    return h("button", { class: done ? "btn secondary" : "btn", onclick: () => {
      if (!tool.ranges.filter(r => !item || r.item === item.id).length) {
        message.replaceChildren(h("div", { class: "note bad" }, "This tool has no ranges set up, so it can't be calibrated here. Use Custom Entry, or set up its ranges at the desktop."));
        return window.scrollTo(0, 0);
      }
      if (done && !confirm(`${item ? `${tool.tool_id} · ${item.name}` : tool.tool_id} was already calibrated on this device (${done.by_name} at ${timeText(done.saved_at)}).\n\nCalibrate it again?`))
        return;
      go(itemHash("cal", tool, item));
    } }, done ? "Calibrate Again" : "Calibrate");
  }

  // ---------- Calibrate and Custom Entry (new, or changing one not sent yet) ----------
  function startForm() {
    state.formHash = location.hash;
    state.formDirty = false;
  }

  function formHeader(title, subtitle) {
    return h("header", { class: "bar compact" },
      h("div", { class: "bar-row" },
        h("button", { class: "icon-btn plain", "aria-label": "Back", onclick: () => history.back() }, icon("back")),
        h("div", { class: "form-title" }, h("h1", {}, title), h("span", {}, subtitle))));
  }

  function dateField(label, value, { optional = false } = {}) {
    const input = h("input", { type: "date", value: value || "" });
    const field = h("label", { class: "field" }, label, input);
    if (optional) {
      const clear = h("button", { type: "button", class: "link-btn small-link", onclick: () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } }, "No due date");
      field.append(clear);
    }
    return { field, input };
  }

  function formError(box, text) {
    box.replaceChildren(h("div", { class: "note bad" }, text));
    box.scrollIntoView({ block: "center" });
  }

  async function storeEntry(entry, existing) {
    if (existing) Object.assign(existing, entry);
    else state.work.entries.push(entry);
    if (!await saveWork()) return false;
    state.formHash = null;
    state.formDirty = false;
    return true;
  }

  async function deleteEntry(entry) {
    if (!confirm("Delete this entry from this device?")) return;
    state.work.entries = state.work.entries.filter(e => e !== entry);
    if (await saveWork()) {
      state.formHash = null;
      state.formDirty = false;
      toast("Entry deleted");
      history.back();
    }
  }

  // unitIds: a split tool's items being calibrated (one, or every item sent: the
  // whole tool); null for a tool not split
  function calibrateScreen(original, entry, unitIds) {
    const tool = current(original);
    const deviation = Rules.parseDeviation(tool.deviation);
    if (entry && tool.items) unitIds = [...new Set(entry.ranges.map(r => r.item_id))];
    const units = (unitIds || []).map(id => itemOf(tool, id)).filter(Boolean);
    const byItem = units.length > 1;            // (each item under its heading, with its own Next due)
    const rows = entry ? entry.ranges.map(r => ({ ...r }))
      : tool.ranges.filter(r => !unitIds || unitIds.includes(r.item))
          .sort((a, b) => units.findIndex(u => u.id === a.item) - units.findIndex(u => u.id === b.item))
          .map(r => ({ range: r.range, standard: r.standard, as_found: "", after_adj: "", result: "none",
                       remarks: (r.remarks || tool.default_remarks || "").trim(), ...(tool.items ? { item_id: r.item } : {}) }));
    const startDate = entry ? entry.date : Rules.today();
    const date = dateField("Date", startDate);
    const intervalOf = unit => (unit && unit.interval) || tool.interval;
    const savedDue = unit => entry ? ((entry.ranges.find(r => r.item_id === unit.id) || {}).due_date || entry.due_date) : null;
    // The Next due date(s): the tool's (or its one item's), or each item's under its heading
    const dues = (byItem ? units : [units[0] || null]).map(unit => {
      const interval = intervalOf(unit);
      const field = dateField("Next due", entry ? (unit ? savedDue(unit) : entry.due_date) : Rules.dueFromInterval(startDate, interval),
                              { optional: Rules.intervalIsNever(interval) });
      return { unit, interval, field, following: Rules.dueFromInterval(date.input.value, interval) || null };
    });
    const due = dues[0].field;
    const errors = h("div", { role: "alert" });
    let unlocked = false;

    // A due date follows the date (date + the interval) unless it's been changed by hand
    date.input.addEventListener("input", () => {
      if (!Rules.parseIso(date.input.value)) return;
      for (const d of dues) {
        if (d.following === null) continue;
        if (d.field.input.value !== d.following) { d.following = null; continue; }
        d.following = Rules.dueFromInterval(date.input.value, d.interval);
        d.field.input.value = d.following;
      }
    });

    const cards = rows.map((row, i) => {
      const saved = { as_found: row.as_found, after_adj: row.after_adj };
      const auto = { byHand: ["pass", "fail"].includes(row.result), value: null };
      const numeric = Rules.parseMeasurement(row.range) !== null;
      const rangeIn = h("input", { type: "text", value: row.range, "aria-label": "Range", disabled: true, class: "locked" });
      const stdIn = h("input", { type: "text", value: row.standard, "aria-label": "Standard used", disabled: true, class: "locked" });
      const found = h("input", { type: "text", inputmode: numeric ? "decimal" : "text", value: row.as_found, autocomplete: "off" });
      const adj = h("input", { type: "text", inputmode: numeric ? "decimal" : "text", value: row.after_adj, autocomplete: "off" });
      const remarks = h("input", { type: "text", value: row.remarks, autocomplete: "off" });
      const outNote = h("p", { class: "out-note" }, `Outside the ${tool.deviation_label || "Calibration Tolerance"} (${tool.deviation})`);
      const shortNote = h("p", { class: "out-note" });     // (a reading with fewer decimal places than the range)
      const pass = h("button", { type: "button", class: "toggle pass" }, "Pass");
      const fail = h("button", { type: "button", class: "toggle fail" }, "Fail");

      function showResult() {
        pass.setAttribute("aria-pressed", String(row.result === "pass"));
        fail.setAttribute("aria-pressed", String(row.result === "fail"));
      }

      function setResult(value) {
        row.result = value;
        if (["pass", "fail"].includes(value)) found.classList.remove("needs");     // (named by Save: ticked now)
        remarks.value = Rules.remarksForResult(remarks.value, { pass: "Pass", fail: "Fail" }[value] || "");
        showResult();
        syncAsLeft();
      }

      // As Left (a new calibration), as on the desktop: a Pass copies the As Found reading and
      // follows it, until a reading is typed there; a Fail leaves it blank, in amber, for the
      // reading after adjusting (Save asks why if it's still blank)
      const follow = { on: !entry, value: row.after_adj };
      function asLeftMissing() {
        return !entry && row.result === "fail" && !adj.value.trim();
      }
      function syncAsLeft() {
        if (follow.on && adj.value !== follow.value) follow.on = false;     // (typed by hand: left alone now)
        if (follow.on) {
          const value = row.result === "pass" ? found.value : "";
          if (value !== adj.value) {
            adj.value = value;
            follow.value = value;
            autoResult();                       // (judged again with it: the old copy can't make a bad reading a Pass)
          }
        }
        adj.classList.toggle("needs", asLeftMissing() && !adj.classList.contains("out"));
      }

      function choose(value) {
        auto.byHand = true;
        setResult(row.result === value ? "none" : value);
      }

      // Pass / Fail chosen from the readings until someone picks one themselves: the As Left
      // reading when there is one (adjusted back into tolerance = Pass), else the As Found
      function autoResult() {
        if (auto.byHand) return;
        const verdict = Rules.calibrationResult(rangeIn.value, found.value, adj.value, deviation);
        if (verdict === null) {
          if (auto.value && row.result === auto.value) setResult("none");
          auto.value = null;
          return;
        }
        if (row.result !== verdict) setResult(verdict);
        auto.value = verdict;
      }

      function checkTolerance() {
        const out = [found, adj].map(box => {
          const bad = Rules.outOfTolerance(rangeIn.value, box.value, deviation);
          box.classList.toggle("out", bad);
          return bad;
        });
        outNote.hidden = !out.some(Boolean);
        // Range 2.000": 2.00 could hide 2.002, so it's outlined until typed to the range's decimals
        const needed = [found, adj].map(box => {
          const n = Rules.readingTooShort(rangeIn.value, box.value);
          if (n) box.classList.add("out");
          return n;
        }).find(Boolean);
        shortNote.hidden = !needed;
        if (needed) shortNote.textContent = shortHint(rangeIn.value, needed);
      }

      pass.addEventListener("click", () => choose("pass"));
      fail.addEventListener("click", () => choose("fail"));
      found.addEventListener("input", () => { autoResult(); syncAsLeft(); checkTolerance(); });
      adj.addEventListener("input", () => { autoResult(); syncAsLeft(); checkTolerance(); });
      rangeIn.addEventListener("input", () => { autoResult(); checkTolerance(); });
      for (const [box, key] of [[found, "as_found"], [adj, "after_adj"]])     // 1.000 -> 1.000" (typed now only)
        box.addEventListener("blur", () => {
          if (box.value === saved[key]) return;
          const followed = follow.on && adj.value === follow.value;
          box.value = Rules.addInchMark(box.value, rangeIn.value);
          if (followed && box === adj) follow.value = adj.value;            // (still following, inch mark and all)
          if (box === found) syncAsLeft();
        });
      showResult();
      checkTolerance();
      syncAsLeft();

      const card = h("section", { class: "card range-card" },
        rows.length > 1 ? h("span", { class: "range-num" }, `Range ${i + 1} of ${rows.length}`) : null,
        h("div", { class: "range-head" }, h("label", { class: "field compact" }, "Range", rangeIn),
          h("label", { class: "field compact" }, "Standard used", stdIn)),
        h("div", { class: "pair" }, h("label", { class: "field" }, "As Found", found), h("label", { class: "field" }, "As Left", adj)),
        outNote, shortNote,
        h("div", { class: "pair", role: "group", "aria-label": `Result for ${row.range || `range ${i + 1}`}` }, pass, fail),
        h("label", { class: "field" }, "Remarks", remarks));
      return { row, card, rangeIn, stdIn, found, adj, remarks, saved, choose, asLeftMissing,
               touched: () => !!(found.value.trim() || adj.value.trim() || ["pass", "fail"].includes(row.result)) };
    });
    // The whole tool: each item's heading above its ranges, with its Next due; one left blank isn't recorded
    const sections = byItem ? dues.map(d => {
      const blank = h("p", { class: "small" });
      return { ...d, blank, cards: cards.filter(c => c.row.item_id === d.unit.id),
               head: h("section", { class: "item-head" }, h("div", { class: "item-title" }, h("b", {}, d.unit.name),
                 d.interval ? h("span", { class: "small" }, `every ${d.interval}`) : null), d.field.field, blank) };
    }) : [];
    const sectionBlank = sec => !sec.cards.some(c => c.touched());
    function showBlank() {
      for (const sec of sections) sec.blank.textContent = !entry && sectionBlank(sec) ? "Left blank: not recorded, its due date stays" : "";
    }
    showBlank();

    function unlockRanges() {
      unlocked = true;
      for (const c of cards) for (const box of [c.rangeIn, c.stdIn]) { box.disabled = false; box.classList.remove("locked"); }
      editRanges.disabled = true;
      cards[0].rangeIn.focus();
    }
    const editRanges = h("button", { type: "button", class: "btn secondary slim", onclick: unlockRanges }, "Edit Range / Standard");
    const allPass = cards.length > 1 ? h("button", { type: "button", class: "btn secondary slim", onclick: () => {
      // (the whole tool: only the items started - one left blank stays skipped - unless nothing is yet)
      const started = sections.filter(sec => !sectionBlank(sec)).flatMap(sec => sec.cards);
      for (const c of (byItem && !entry && started.length ? started : cards)) if (c.row.result !== "pass") c.choose("pass");
      showBlank();
    } }, "✓ All Pass") : null;

    async function saveCalibration() {
      errors.replaceChildren();
      for (const c of cards)
        for (const [box, key] of [[c.found, "as_found"], [c.adj, "after_adj"]])
          if (box.value !== c.saved[key]) box.value = Rules.addInchMark(box.value, c.rangeIn.value);
      if (!Rules.parseIso(date.input.value)) return formError(errors, "Enter the date of the calibration.");
      // The whole tool: an item left blank isn't recorded (its due date stays)
      const doing = byItem ? sections.filter(sec => entry || !sectionBlank(sec)) : dues;
      if (byItem && !doing.length) return formError(errors, "Enter the readings for at least one item. An item left blank isn't recorded.");
      const saving = byItem ? doing.flatMap(sec => sec.cards) : cards;
      for (const d of doing) {
        const never = Rules.intervalIsNever(d.interval);
        if (!(never && !d.field.input.value) && !Rules.parseIso(d.field.input.value))
          return formError(errors, d.unit && byItem ? `Enter the next due date for ${d.unit.name}.` : "Enter the next due date.");
      }
      if (unlocked && cards.some(c => !c.rangeIn.value.trim())) return formError(errors, "Range can't be left blank.");
      const undecided = saving.filter(c => !["pass", "fail"].includes(c.row.result));
      for (const c of saving) c.found.classList.toggle("needs", undecided.includes(c) && !c.found.classList.contains("out"));
      if (undecided.length && byItem)
        return formError(errors, `Every range of an item being calibrated needs Pass or Fail – or leave the whole item blank to skip it: ${
          undecided.map(c => `${itemOf(tool, c.row.item_id).name} ${c.rangeIn.value.trim()}`).join(", ")}`);
      if (undecided.length) return formError(errors, "Tick Pass or Fail for every range before saving.");
      // A failed range with no As Left: saved anyway only with a reason (it goes into that range's Remarks)
      const missing = saving.filter(c => c.asLeftMissing());
      if (missing.length) {
        const several = missing.length > 1;
        const reason = prompt(`Range ${missing.map(c => c.rangeIn.value.trim() || "?").join(", ")}: ` +
          `${several ? "these ranges" : "this range"} failed, and As Left (the reading after adjusting) is empty.\n\n` +
          `You can save without it, with a reason: it goes into ${several ? "their" : "its"} Remarks.\n` +
          "(e.g. couldn't be adjusted - sent out for repair)", "");
        if (!reason || !reason.trim()) return formError(errors, "Enter As Left (the reading after adjusting) for each failed range, or save with a reason.");
        for (const c of missing)
          c.remarks.value = `${c.remarks.value.trim()}${c.remarks.value.trim() ? " - " : ""}As Left not recorded: ${reason.trim()}`;
      }
      // (a warning: a reading shorter than the range can be saved anyway)
      const short = saving.flatMap(c => [[c.found, "As Found"], [c.adj, "As Left"]].map(([box, name]) => {
        const n = box.value !== c.saved[box === c.found ? "as_found" : "after_adj"] && Rules.readingTooShort(c.rangeIn.value, box.value);
        return n ? `Range ${c.rangeIn.value.trim()}: ${name} – ${shortHint(c.rangeIn.value, n)}` : null;
      })).filter(Boolean);
      if (short.length && !confirm(`${short.join("\n")}\n\nSave anyway?`)) return;
      const mismatches = saving.map(c => {
        const [lead] = Rules.splitLeadingResult(c.remarks.value);
        return lead && lead !== c.row.result
          ? `${c.rangeIn.value.trim() || "This range"}: remarks say ${lead[0].toUpperCase() + lead.slice(1)} but ${c.row.result[0].toUpperCase() + c.row.result.slice(1)} is ticked`
          : null;
      }).filter(Boolean);
      if (mismatches.length && !confirm(`${mismatches.join("\n")}\n\nSave anyway?`)) return;

      // (a split tool: each range with its item and that item's due date; the entry's: the soonest)
      const dueOf = c => (byItem ? doing.find(d => d.unit.id === c.row.item_id) : dues[0]).field.input.value || "";
      const record = {
        id: entry ? entry.id : CalCheck.randomHex(8), tool_id: tool.tool_id, kind: "measurement",
        date: date.input.value, due_date: saving.map(dueOf).filter(Boolean).sort()[0] || "",
        ranges: saving.map(c => ({ range: c.rangeIn.value.trim(), standard: c.stdIn.value.trim(), as_found: c.found.value.trim(),
                                    after_adj: c.adj.value.trim(), result: c.row.result, remarks: c.remarks.value.trim(),
                                    ...(tool.items ? { item_id: c.row.item_id, due_date: dueOf(c) } : {}) })),
        note: "", status: "", status_before: "",
        by: entry ? entry.by : state.user.username, by_name: entry ? entry.by_name : state.user.name,
        saved_at: entry ? entry.saved_at : nowIso(), changed_at: entry ? nowIso() : null, sent_at: null,
      };
      if (await storeEntry(record, entry)) {
        toast(entry ? "Changes saved on this device" : "Calibration saved on this device");
        history.back();
      }
    }

    startForm();
    const what = byItem ? `Whole tool · ${plural(units.length, "item")}` : units[0] ? units[0].name : tool.name;
    show(h("div", { class: "screen" },
      formHeader(`${entry ? "Change" : "Calibrate"} ${tool.tool_id}`, [what, tool.deviation].filter(Boolean).join(" · ")),
      h("main", { class: "body with-actions", oninput: () => { state.formDirty = true; showBlank(); }, onclick: e => {
        if (e.target.closest(".toggle, .slim")) { state.formDirty = true; showBlank(); }
      } },
        errors,
        byItem ? date.field : h("div", { class: "pair" }, date.field, due.field),
        h("p", { class: "small" }, `Inspector: ${entry ? entry.by_name : state.user.name}`),
        byItem ? sections.flatMap(sec => [sec.head, ...sec.cards.map(c => c.card)]) : cards.map(c => c.card),
        h("div", { class: "pair" }, editRanges, allPass || h("span", {})),
        entry ? h("button", { type: "button", class: "link-btn danger", onclick: () => deleteEntry(entry) }, "Delete this entry") : null),
      h("div", { class: "actions single" },
        h("button", { class: "btn", onclick: saveCalibration }, entry ? "Save Changes" : "Save on this device"))));
  }

  // itemId: a split tool's item it's for (none: chosen on the screen - the whole tool, when every item was sent)
  function customScreen(original, entry, itemId) {
    const tool = current(original);
    const quick = state.data.quick_entries || [];
    const sent = sentItems(tool);
    const wholeOk = tool.items && sent.length === tool.items.length;
    const forItem = tool.items ? h("select", {},
      (wholeOk ? [h("option", { value: "" }, "Whole tool (every item)")] : []).concat(sent.map(i => h("option", {
        value: String(i.id), selected: String(i.id) === String(entry ? entry.item_id : itemId) }, i.name)))) : null;
    const statuses = state.data.statuses || STATUSES;
    const note = h("textarea", { rows: "4" });
    note.value = entry ? entry.note : "";
    const date = dateField("Date", entry ? entry.date : Rules.today());
    const due = dateField("Next due", entry ? entry.due_date : "", { optional: true });
    const statusBefore = entry ? entry.status_before : tool.status;
    const status = h("select", {}, statuses.map(s => h("option", { value: s, selected: s === (entry ? entry.status : tool.status) }, s)));
    const errors = h("div", { role: "alert" });

    const quickButtons = quick.map(text => {
      const b = h("button", { type: "button", class: "quick" }, text);
      b.addEventListener("click", () => {
        // Replaces an empty box (or another quick entry); typed text is kept, with this on a new line
        const now = note.value.trim();
        note.value = now && !quick.includes(now) ? `${now}\n${text}` : text;
        markQuick();
      });
      return b;
    });
    function markQuick() {
      for (const b of quickButtons) b.setAttribute("aria-pressed", String(note.value.split("\n").includes(b.textContent)));
    }
    note.addEventListener("input", markQuick);
    markQuick();

    async function saveCustom() {
      errors.replaceChildren();
      if (!Rules.parseIso(date.input.value)) return formError(errors, "Enter the date of the entry.");
      if (due.input.value && !Rules.parseIso(due.input.value)) return formError(errors, "Enter a valid next due date, or tap No due date.");
      if (!note.value.trim()) return formError(errors, "Please enter some text for this entry.");
      const record = {
        id: entry ? entry.id : CalCheck.randomHex(8), tool_id: tool.tool_id, kind: "custom",
        date: date.input.value, due_date: due.input.value || "", ranges: [],
        note: note.value.trim(), status: status.value, status_before: statusBefore,
        by: entry ? entry.by : state.user.username, by_name: entry ? entry.by_name : state.user.name,
        saved_at: entry ? entry.saved_at : nowIso(), changed_at: entry ? nowIso() : null, sent_at: null,
        ...(forItem ? { item_id: forItem.value ? Number(forItem.value) : null } : {}),
      };
      if (await storeEntry(record, entry)) {
        toast(entry ? "Changes saved on this device" : "Entry saved on this device");
        history.back();
      }
    }

    startForm();
    show(h("div", { class: "screen" },
      formHeader(`${entry ? "Change Entry" : "Custom Entry"} · ${tool.tool_id}`, tool.name),
      h("main", { class: "body with-actions", oninput: () => { state.formDirty = true; }, onclick: e => {
        if (e.target.closest(".quick")) state.formDirty = true;
      } },
        errors,
        forItem ? h("label", { class: "field" }, "For", forItem) : null,
        quick.length ? h("section", { class: "quick-list" }, h("h2", { class: "group" }, "Quick fill"), quickButtons) : null,
        h("label", { class: "field" }, "Entry", note),
        h("div", { class: "pair" }, date.field, due.field),
        h("label", { class: "field" }, "Tool status", status),
        h("p", { class: "small" }, `Inspector: ${entry ? entry.by_name : state.user.name}`),
        entry ? h("button", { type: "button", class: "link-btn danger", onclick: () => deleteEntry(entry) }, "Delete this entry") : null),
      h("div", { class: "actions single" },
        h("button", { class: "btn", onclick: saveCustom }, entry ? "Save Changes" : "Save Entry"))));
  }

  // An entry already saved: change it (if it's yours and not sent), else just show it
  function entryScreen(id) {
    const entry = state.work.entries.find(e => e.id === id);
    if (!entry) { go("#/completed"); return; }
    const tool = state.data.tools.find(t => t.tool_id === entry.tool_id);
    if (canChange(entry) && tool) return entry.kind === "custom" ? customScreen(tool, entry) : calibrateScreen(tool, entry, null);

    const why = entry.sent_at ? `Sent ${localDay(entry.sent_at)} at ${timeText(entry.sent_at)}: any correction is made at the desktop.`
      : entry.by !== state.user.username ? `Made by ${entry.by_name}: only they can change it.`
      : "The file has expired: entries can only be sent now.";
    const fact = (label, value) => h("div", { class: "fact" }, h("span", {}, label), h("span", {}, value || "–"));
    show(h("div", { class: "screen" },
      formHeader(`${entry.kind === "custom" ? "Entry" : "Calibration"} · ${entry.tool_id}`, tool ? tool.name : ""),
      h("main", { class: "body" },
        h("div", { class: "note info" }, why),
        h("section", { class: "card facts" },
          fact("Date", Dates.display(entry.date)), fact("Next due", entry.due_date ? Dates.display(entry.due_date) : "No due date"),
          fact("Inspector", entry.by_name), fact("Saved", timeText(entry.saved_at)),
          entry.kind === "custom" ? fact("Tool status", entry.status) : null),
        entry.kind === "custom"
          ? h("section", { class: "card note-text" }, entry.note)
          : h("section", { class: "card" }, entry.ranges.map(r => h("div", { class: "line" },
              h("span", { class: "line-main" },
                h("span", {}, [tool && r.item_id ? (itemOf(tool, r.item_id) || { name: "" }).name : "", r.range, r.standard].filter(Boolean).join(" · ")),
                h("span", {}, `As Found ${r.as_found || "–"} · As Left ${r.after_adj || "–"}${r.remarks ? ` · ${r.remarks}` : ""}`)),
              h("span", { class: `result ${r.result === "fail" ? "Fail" : "Pass"}` }, r.result === "fail" ? "Fail" : "Pass")))))));
  }

  // ---------- Send Results ----------
  function sendScreen() {
    const entries = state.work.entries;
    const failed = entries.filter(e => entryResult(e) === "Fail").length;
    const doneTools = new Set(entries.map(e => e.tool_id));
    const notDone = state.data.tools.filter(t => !doneTools.has(t.tool_id)).map(t => t.tool_id);
    const unsent = entries.filter(e => !e.sent_at).length;
    const lastSend = state.work.sends[state.work.sends.length - 1];
    const message = h("div", { role: "alert" });
    const shortName = state.user.name.replace(/[^A-Za-z0-9]/g, "") || "Inspector";

    async function makeFile() {
      const text = await CalCheck.sealResults(state.key, state.header.session, state.user.username, state.user.name,
                                              entries, APP_VERSION);
      const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
      return new File([text], `Results_${state.header.session}_${shortName}_${stamp}.txt`, { type: "text/plain" });
    }

    async function markSent(how) {
      const at = nowIso();
      for (const e of entries) e.sent_at = e.sent_at || at;
      state.work.sends.push({ at, how, count: entries.length, by: state.user.username });
      await saveWork();
      toast("Results sent");
      route();
    }

    async function share() {
      if (!entries.length) return;
      const file = await makeFile();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Calibration results", text: `Calibration results ${state.header.session} from ${state.user.name}` });
          await markSent("shared");
        } catch (e) {
          if (e.name !== "AbortError")
            message.replaceChildren(h("div", { class: "note bad" }, "The device couldn't share the file. Use Save File instead, then attach it to an email."));
        }
        return;
      }
      saveFile(file);
    }

    async function saveFile(file) {
      file = file instanceof File ? file : await makeFile();
      const url = URL.createObjectURL(file);
      const a = h("a", { href: url, download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (confirm(`Saved ${file.name}.\n\nAttach it to an email to the desktop. Mark these results as sent?`)) await markSent("saved");
    }

    show(h("div", { class: "screen" },
      formHeader("Send Results", `${state.header.session} · ${state.user.name}`),
      h("main", { class: "body" },
        message,
        h("section", { class: "card stats" },
          h("div", {}, h("b", {}, entries.length), h("span", {}, entries.length === 1 ? "entry" : "entries")),
          h("div", {}, h("b", { class: failed ? "fail-text" : "" }, failed), h("span", {}, "failed")),
          h("div", {}, h("b", { class: "muted" }, notDone.length), h("span", {}, "tools not done"))),
        notDone.length ? h("section", { class: "note warn" },
          h("b", {}, `${plural(notDone.length, "tool")} not done`),
          h("span", {}, `${notDone.slice(0, 12).join(" · ")}${notDone.length > 12 ? " ..." : ""} – they stay due and can go in the next session.`)) : null,
        h("section", { class: "card padded" },
          h("p", {}, "The results file is locked with this session's key, so only the desktop can read it. Email it to whoever imports results at the computer."),
          h("p", { class: "small" }, unsent ? `${plural(unsent, "entry", "entries")} not sent yet.`
            : lastSend ? `Everything was sent at ${timeText(lastSend.at)}. Sending again is safe: the desktop adds each entry once.` : "")),
        h("button", { class: "btn wide", disabled: !entries.length, onclick: share }, icon("mail", 20), "Email Results"),
        h("button", { class: "link-btn center", disabled: !entries.length, onclick: () => saveFile() }, "Save File instead"),
        h("p", { class: "small center" }, "Opens your device's share sheet with the file attached. Your entries stay on this device until the file is removed."))));
  }

  // ---------- moving between screens (the phone's back button works) ----------
  // ---------- Scan a Label: the camera reads a tool's calibration label ----------
  // (the code holds the Tool ID: a tool sent to calibrate opens ready to; any
  // other in the file opens view only; one not in the file says so)
  function stopCamera() {
    if (state.camera) state.camera.stop();
    state.camera = null;
  }

  function cameraTrouble(err) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return "This phone's browser can't use the camera here. Open the app from its https:// address.";
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError"))
      return "The camera isn't allowed for this app. Allow it in the phone's settings (or the browser's), then try again.";
    if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) return "No camera was found on this device.";
    if (err && err.name === "NotReadableError") return "The camera is busy in another app. Close it, then try again.";
    return "The camera couldn't be started.";
  }

  function scanScreen() {
    stopCamera();
    const video = h("video", { autoplay: "", playsinline: "", "aria-label": "Camera" });
    video.muted = true;
    // (phone cameras can't focus close up - many need 6 in or more - so: farther back, zoomed in)
    const hint = h("p", { class: "hint" }, "Hold the phone about 6 in (15 cm) away,", h("br"),
                   "the label's square code in the frame");
    const result = h("div", { role: "status" });
    const torch = h("button", { class: "round", "aria-label": "Light", hidden: "" }, icon("torch"));
    const zoomButton = h("button", { class: "round zoom", "aria-label": "Zoom", hidden: "" }, "2×");
    const lensButton = h("button", { class: "round zoom", "aria-label": "Lens", hidden: "" }, "1");
    const guide = h("div", { class: "guide" }, h("i"), h("i"), h("i"), h("i"));
    // Take Photo: the phone's own camera app (its own focus, lens and sharpening, on every
    // phone), and the label read from the photo - when the live picture won't read
    const photoInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: "" });
    const photoButton = h("button", { class: "photo-btn", onclick: () => { pauseCamera(); photoInput.click(); } },
      icon("camera", 20), "Take Photo");
    const photoHint = h("p", { class: "photo-hint", hidden: "" }, "Hard to read? Take a photo instead");
    show(h("div", { class: "scanner" },
      h("div", { class: "view" }, video, guide,
        h("div", { class: "top" },
          h("button", { class: "round", "aria-label": "Close", onclick: () => history.length > 1 ? history.back() : go("#/due") },
            icon("close")),
          h("h1", {}, "Scan a Label"), lensButton, zoomButton, torch),
        hint, h("div", { class: "photo-bar" }, photoHint, photoButton, photoInput), result)));

    let stream = null, timer = null, stopped = false, lit = false, tries = 0;
    const camera = { stop() {
      stopped = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    } };
    // (the live picture off while the phone's camera app takes the photo: some phones allow only one)
    function pauseCamera() {
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    state.camera = camera;
    const picture = document.createElement("canvas");
    const MOST = 900;                           // (pixels across, at most, of the part read)

    // The part of the camera's picture inside the guide (and a margin round it,
    // so a code needn't be lined up exactly), in the picture's own pixels: the
    // video fills the screen cropped ("cover"), so the screen is scaled to it
    function guideArea() {
      const box = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
      const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
      const left = (box.width - video.videoWidth * scale) / 2, top = (box.height - video.videoHeight * scale) / 2;
      const side = Math.min(g.width * 1.3 / scale, video.videoWidth, video.videoHeight);
      const x = (g.left + g.width / 2 - box.left - left) / scale - side / 2;
      const y = (g.top + g.height / 2 - box.top - top) / scale - side / 2;
      return { x: Math.max(0, Math.min(video.videoWidth - side, x)), y: Math.max(0, Math.min(video.videoHeight - side, y)), side };
    }

    async function look() {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        // The guide's part of the picture, at the camera's own detail (up to MOST pixels across)
        const { x, y, side } = guideArea();
        const size = Math.round(Math.min(side, MOST));
        picture.width = picture.height = size;
        picture.getContext("2d", { willReadFrequently: true }).drawImage(video, x, y, side, side, 0, 0, size, size);
        let text = null;
        try { text = await Scan.read(picture); } catch (e) {
          hint.textContent = e.message;
        }
        if (stopped || !stream) return;
        if (text) return found(text.trim());
        if (++tries === 40) photoHint.hidden = false;      // (several seconds without a read)
      }
      if (stream) timer = setTimeout(look, 120);
    }

    // (no photo taken: the live picture back)
    photoInput.addEventListener("cancel", () => { if (!stream) startCamera(chosenLens()).catch(() => {}); });
    // A photo from the phone's camera app: the code is where it was aimed, near the middle - read
    // from squares round the middle, tightest first (the code biggest in them), then the whole photo
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files[0];
      photoInput.value = "";
      if (!file) return startCamera(chosenLens());
      hint.textContent = "Reading the photo...";
      let text = null;
      try {
        const image = await createImageBitmap(file);
        const short = Math.min(image.width, image.height);
        for (const part of [0.2, 0.3, 0.45, 0.65, 1]) {
          const w = part === 1 ? image.width : short * part, ht = part === 1 ? image.height : short * part;
          const scale = Math.min(1, 1200 / Math.max(w, ht));
          picture.width = Math.round(w * scale);
          picture.height = Math.round(ht * scale);
          picture.getContext("2d", { willReadFrequently: true })
            .drawImage(image, (image.width - w) / 2, (image.height - ht) / 2, w, ht, 0, 0, picture.width, picture.height);
          text = await Scan.read(picture);
          if (text) break;
        }
      } catch (e) { /* (not a picture it can open) */ }
      if (stopped) return;
      if (text) return found(text.trim());
      hint.textContent = "Couldn't read the code in that photo. Take it again, a little closer and square on.";
      startCamera(chosenLens());
    });

    function found(text) {
      const id = text.toLowerCase();
      const tool = state.data.tools.find(t => t.tool_id.toLowerCase() === id) ||
                   (state.data.view_tools || []).find(t => t.tool_id.toLowerCase() === id);
      if (navigator.vibrate) navigator.vibrate(60);
      if (tool) {
        camera.stop();
        location.replace(`#/tool/${encodeURIComponent(tool.tool_id)}`);     // (Back from the tool: the list, not the camera)
        return;
      }
      result.replaceChildren(h("div", { class: "found" },
        h("span", { class: "warn", "aria-hidden": "true" }, "!"),
        h("span", { class: "msg" }, h("b", {}, `${text.slice(0, 30)} isn't in this file`),
          h("span", {}, "Ask for it to be sent to your phone")),
        h("button", { onclick: () => { result.replaceChildren(); stream ? look() : startCamera(chosenLens()); } }, "Scan Again")));
    }

    // The phone's back lenses: the main one first. Phones name them their own way
    // (Android's "camera2 0, facing back", iPhone's "Back Camera"); left to itself
    // a browser often takes an ultra-wide one, soft at one side up close
    let lenses = [];
    function backLenses(devices) {
      const back = devices.filter(d => d.kind === "videoinput" && !/front|user|selfie/i.test(d.label));
      const special = d => /ultra|wide angle|tele|depth|macro|dual|triple/i.test(d.label);
      const number = d => { const m = /camera2? ?(\d+)/i.exec(d.label); return m ? +m[1] : 99; };
      return [...back.filter(d => !special(d)).sort((a, b) => number(a) - number(b)), ...back.filter(special)];
    }
    function chosenLens() {
      const kept = load("scanLens");
      return lenses.find(d => d.deviceId === kept) ? kept : lenses.length ? lenses[0].deviceId : null;
    }
    torch.onclick = async () => {
      const track = stream && stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({ advanced: [{ torch: !lit }] });
        lit = !lit;
        torch.classList.toggle("on", lit);
      } catch (e) { torch.hidden = true; }
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hint.textContent = cameraTrouble(null);
      photoHint.hidden = false;
      return;
    }

    // Tap the picture: focus there (where the phone lets the app), then back to focusing all the time
    video.addEventListener("click", e => {
      const track = stream && stream.getVideoTracks()[0];
      const can = track && track.getCapabilities ? track.getCapabilities() : {};
      if (!track || !can.focusMode) return;
      const box = video.getBoundingClientRect();
      const point = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      track.applyConstraints({ advanced: [{ focusMode: can.focusMode.includes("single-shot") ? "single-shot" : "continuous",
                                            pointsOfInterest: [point] }] }).catch(() => {});
      setTimeout(() => track.readyState === "live" && can.focusMode.includes("continuous") &&
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 1500);
    });

    // A lens (or, the first time, whichever the browser gives - then the main back lens, once the
    // phone has said which lenses it has); at the most detail it has, up to 4K
    function startCamera(deviceId) {
      if (stopped) return Promise.resolve();
      if (stream) stream.getTracks().forEach(t => t.stop());
      return navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
        width: { ideal: 3840 }, height: { ideal: 2160 } } }).then(got => running(got, deviceId));
    }
    lensButton.onclick = () => {
      const at = lenses.findIndex(d => d.deviceId === chosenLens());
      const next = lenses[(at + 1) % lenses.length];
      save("scanLens", next.deviceId);
      startCamera(next.deviceId).catch(err => { hint.textContent = cameraTrouble(err); });
    };

    startCamera(null)
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devices => {
        lenses = backLenses(devices);
        lensButton.hidden = lenses.length < 2;
        const best = chosenLens();
        const now = stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId;
        if (best && best !== now) return startCamera(best);       // (the main back lens, not the browser's pick)
      })
      .catch(err => { hint.textContent = cameraTrouble(err); photoHint.hidden = false; });

    function running(got, deviceId) {
        if (stopped) { got.getTracks().forEach(t => t.stop()); return; }
        stream = got;
        video.srcObject = got;
        video.play().catch(() => {});
        const track = got.getVideoTracks()[0];
        const can = track && track.getCapabilities ? track.getCapabilities() : {};
        lensButton.textContent = String(Math.max(1, lenses.findIndex(d => d.deviceId === deviceId) + 1));
        torch.hidden = !can.torch;              // (a light where the phone lets the app use it: not on iPhones)
        lit = false;
        torch.classList.remove("on");
        // Focusing all the time, on the middle (the guide), and zoomed in 2x (1x / 2x / 3x on the
        // button) - where the phone lets it
        if (track && can.focusMode && can.focusMode.includes("continuous"))
          track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        if (track && "pointsOfInterest" in (track.getSettings ? track.getSettings() : {}))
          track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: 0.5, y: 0.5 }] }] }).catch(() => {});
        if (track && can.zoom && can.zoom.max >= 1.5) {
          const zooms = [1, 2, 3].filter(z => z >= can.zoom.min && z <= can.zoom.max);
          let at = zooms.includes(2) ? 2 : zooms[zooms.length - 1];
          const setZoom = z => track.applyConstraints({ advanced: [{ zoom: z }] })
            .then(() => { at = z; zoomButton.textContent = `${z}×`; }, () => { zoomButton.hidden = true; });
          zoomButton.hidden = zooms.length < 2;
          zoomButton.onclick = () => setZoom(zooms[(zooms.indexOf(at) + 1) % zooms.length]);
          setZoom(at);
        }
        Scan.loadZxing().catch(() => {});       // (ready before it's needed, where there's no reader of the phone's own)
        clearTimeout(timer);
        look();
    }
  }

  function route() {
    if (!state.data) return openScreen();
    if (state.formHash && state.formDirty && location.hash !== state.formHash) {
      if (!confirm("Leave without saving? What you've typed will be lost.")) {
        history.pushState(null, "", state.formHash);
        return;
      }
    }
    state.formHash = null;
    state.formDirty = false;
    if (loggedInTooLong()) {
      lock();
      return openScreen();
    }
    state.expired = CalCheck.isExpired(state.header);
    if (state.expired && !state.work.entries.some(e => !e.sent_at)) {
      removeFile();
      return openScreen("The session file has expired and was removed from this device. Ask for a new one.");
    }
    const hash = location.hash;
    if (hash !== "#/scan") stopCamera();
    if (hash === "#/scan") return scanScreen();
    // (#/tool/GMS001, or an item's: #/tool/GMS001/item/5 - #/cal/GMS001/item/all: the whole tool)
    const part = prefix => {
      const [id, unit] = hash.slice(prefix.length).split("/item/");
      return [decodeURIComponent(id), unit === undefined ? null : decodeURIComponent(unit)];
    };
    const tool = id => state.data.tools.find(t => t.tool_id === id);
    if (hash.startsWith("#/tool/")) return toolScreen(...part("#/tool/"));
    if (hash.startsWith("#/pick/") && tool(part("#/pick/")[0]) && !state.expired) return pickScreen(tool(part("#/pick/")[0]));
    if (hash.startsWith("#/cal/") && tool(part("#/cal/")[0]) && !state.expired) {
      const [id, unit] = part("#/cal/");
      const t = tool(id);
      if (!t.items) return calibrateScreen(t, null, null);
      const units = unit === "all" ? sentItems(t).map(i => i.id) : sentItems(t).filter(i => String(i.id) === unit).map(i => i.id);
      if (!units.length) return go(itemHash("pick", t));       // (a split tool: which item first)
      return calibrateScreen(t, null, units);
    }
    if (hash.startsWith("#/custom/") && tool(part("#/custom/")[0]) && !state.expired)
      return customScreen(tool(part("#/custom/")[0]), null, part("#/custom/")[1]);
    if (hash.startsWith("#/entry/")) return entryScreen(part("#/entry/"));
    if (hash === "#/send") return sendScreen();
    state.tab = hash === "#/all" ? "all" : hash === "#/completed" ? "completed" : "due";
    if (state.tab === "all") return allScreen();
    if (state.tab === "completed") return completedScreen();
    return dueScreen();
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("resize", fitBarHeight);
  // (the camera off while the app is out of sight; back on when it's back, still on Scan a Label)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
    else if (location.hash === "#/scan" && state.data) route();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && loggedInTooLong() && !state.formDirty) { lock(); openScreen(); }      // (left open past midnight)
  });
  window.addEventListener("beforeunload", e => {
    if (state.formDirty) { e.preventDefault(); e.returnValue = ""; }
  });

  if (!window.crypto || !crypto.subtle) {
    show(h("div", { class: "screen" }, brandHero(),
      h("div", { class: "panel" }, h("div", { class: "note bad" }, "This browser can't unlock session files. Open the app's https:// link in Safari or Chrome."))));
    return;
  }
  if ("serviceWorker" in navigator) {
    // An update that arrives while the app is open takes over straight away:
    // reload once onto it (still logged in, so no PIN) - but never in the
    // middle of typing an entry (it's used the next time the app opens)
    const hadVersion = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadVersion && !reloading && !state.formDirty) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").catch(() => { /* still works while online */ });
  }

  (async () => {
    const header = storedHeader();
    if (header && (!CalCheck.isExpired(header) || unsentFor(header.session)) && await resumeLogin(header)) {
      if (location.hash.startsWith("#/")) route();
      else location.hash = "#/due";             // (shows it)
      return;
    }
    openScreen();
  })();
})();
