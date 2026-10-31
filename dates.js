// Dates and due colours, worked out the same way as the desktop app
// (helpers.iso_to_display, database.due_date_severity); tests compare the two.
"use strict";

const Dates = (() => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = n => String(n).padStart(2, "0");
  // The desktop's date formats (helpers.DATE_FORMATS): its on-screen one comes in the file
  const FORMATS = {
    mdy_comma: d => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    mdy: d => `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`,
    dmy: d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    iso: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    mdy_num: d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
    dmy_num: d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
  };
  let format = "mdy_comma";

  function setFormat(key) {
    format = FORMATS[key] ? key : "mdy_comma";
  }
  const DAY = 86400000;

  function parse(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // '2026-09-25' -> 'Sep 25, 2026', in the format in use (anything else is shown as it is)
  function display(iso) {
    const d = parse(iso);
    return d ? FORMATS[format](d) : (iso || "");
  }

  // A moment (the file's expiry) -> 'Oct 9, 2026 3:15 PM' in the phone's time
  function displayMoment(text) {
    const d = new Date(text);
    if (isNaN(d)) return text || "";
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${FORMATS[format](d)} ${time}`;
  }

  function daysUntil(iso, today = new Date()) {
    const d = parse(iso);
    return d ? Math.round((d - startOfDay(today)) / DAY) : null;
  }

  // 'red' / 'yellow' / 'green' / 'none', with the desktop's Due Colours
  // settings (rules: {overdue_after, due_soon}, carried in the file)
  function severity(iso, rules, today = new Date()) {
    const days = daysUntil(iso, today);
    if (days === null) return "none";
    if (days < -rules.overdue_after) return "red";
    if (days <= rules.due_soon) return "yellow";
    return "green";
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  // 'Due in 8 days', 'Due today', '36 days overdue', 'No due date'
  function whenText(iso, today = new Date()) {
    const days = daysUntil(iso, today);
    if (days === null) return "No due date";
    if (days === 0) return "Due today";
    if (days > 0) return `Due in ${plural(days, "day")}`;
    return `${plural(-days, "day")} overdue`;
  }

  // 14 -> '2 weeks' ('2+ weeks' with plus), 1 -> '1 day' (helpers.days_text)
  function daysText(days, plus = false) {
    const [number, unit] = days && days % 7 === 0 ? [days / 7, "week"] : [days, "day"];
    return `${number}${plus ? "+" : ""} ${unit}${number !== 1 || plus ? "s" : ""}`;
  }

  // The counts over the Due list, worded as on the desktop
  // (database.overdue_count_text / due_soon_count_text)
  function overdueCountText(count, rules) {
    return `${count} overdue` + (rules.overdue_after ? ` ${daysText(rules.overdue_after, true)}` : "");
  }

  function dueSoonCountText(count, rules) {
    return `${count} due within ${daysText(rules.due_soon)}`;
  }

  return { setFormat, display, displayMoment, daysUntil, severity, whenText, overdueCountText, dueSoonCountText };
})();
