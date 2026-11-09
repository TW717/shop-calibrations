// The desktop app's calibration rules, worked out the same way on the phone
// (helpers.py: parse_measurement, parse_deviation, tolerance_result,
// add_inch_mark, split_leading_result, due_date_from_interval). Tests run
// both on the same cases, so a Pass here is a Pass there.
"use strict";

const Rules = (() => {
  const NUMBER = String.raw`(?:\d+\.?\d*|\.\d+)`;       // (its sign apart)
  const FRACTION = String.raw`(?:\d+[\s-]+)?\d+\/\d+`;

  // Units: {spelling, tidied: [what it measures, its size in that kind's base unit]} (helpers.py UNITS)
  const UNITS = {
    '"': ["length", 25.4], "in": ["length", 25.4], "inch": ["length", 25.4], "inches": ["length", 25.4],
    "mm": ["length", 1], "cm": ["length", 10], "um": ["length", 0.001], "micron": ["length", 0.001],
    "microns": ["length", 0.001],
    "v": ["voltage", 1], "vac": ["voltage", 1], "vdc": ["voltage", 1], "mv": ["voltage", 0.001],
    "kv": ["voltage", 1000], "uv": ["voltage", 0.000001],
    "a": ["current", 1], "ma": ["current", 0.001], "ua": ["current", 0.000001],
    "ohm": ["resistance", 1], "kohm": ["resistance", 1000], "mohm": ["resistance", 1000000],
    "hz": ["frequency", 1], "khz": ["frequency", 1000], "mhz": ["frequency", 1000000],
    "psi": ["pressure", 1], "psig": ["pressure", 1], "bar": ["pressure", 14.5037738],
    "kpa": ["pressure", 0.145037738], "mpa": ["pressure", 145.037738],
    "nm": ["torque", 1], "ftlb": ["torque", 1.3558179483], "ftlbs": ["torque", 1.3558179483],
    "lbft": ["torque", 1.3558179483], "ftlbf": ["torque", 1.3558179483], "lbfft": ["torque", 1.3558179483],
    "inlb": ["torque", 0.112984829], "inlbs": ["torque", 0.112984829], "lbin": ["torque", 0.112984829],
    "inlbf": ["torque", 0.112984829], "lbfin": ["torque", 0.112984829], "inoz": ["torque", 0.0070615518],
    "ozin": ["torque", 0.0070615518],
    "lb": ["force", 1], "lbs": ["force", 1], "lbf": ["force", 1], "kg": ["force", 2.20462262],
    "kgf": ["force", 2.20462262], "g": ["force", 0.00220462262], "n": ["force", 0.224808943],
    "oz": ["force", 0.0625], "ozf": ["force", 0.0625],
    "deg": ["angle", 1], "°": ["angle", 1],
    "°f": ["temp f", 1], "f": ["temp f", 1], "degf": ["temp f", 1],
    "°c": ["temp c", 1], "c": ["temp c", 1], "degc": ["temp c", 1],
    "turns": ["turns", 1],        // (T, Turn, Turn(s), Rev: unitKey spells them all "turns")
  };

  // 'mV' -> 'mv', 'ft-lb' -> 'ftlb', 'kΩ' -> 'kohm', 'in.' -> 'in', 'T' / 'Turn(s)' -> 'turns'
  function unitKey(text) {
    let key = (text || "").toLowerCase().replace(/[\s·.\-]/g, "").replace(/[µμ]/g, "u").replace(/ω/g, "ohm")
      .replace(/″/g, '"').replace(/ohms/g, "ohm");
    if (["t", "turn", "turn(s)", "rev", "revs"].includes(key)) key = "turns";
    return key || null;
  }

  // '2.000' -> 2, '1/64' -> 0.015625, '1-1/2' -> 1.5
  function number(text) {
    const m = /^(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/.exec(text);
    if (m) return +m[3] ? (+(m[1] || 0)) + (+m[2]) / (+m[3]) : null;
    return parseFloat(text);
  }

  // '2.000"' -> [2, '"'], '10.02 V' -> [10.02, 'v'], '1-1/2"' -> [1.5, '"'], '-1/2 T' -> [-0.5, 'turns'],
  // 'Flush' -> [0, 'turns']; ranges, N/A, text -> null
  function measurementParts(text) {
    if ((text || "").trim().toLowerCase() === "flush") return [0, "turns"];
    const m = new RegExp(String.raw`^\s*([+-]?)\s*(${FRACTION}|${NUMBER})\s*([^\d\s+\-.\/][^\d]*?)?\s*$`).exec(text || "");
    if (!m) return null;
    const value = number(m[2]);
    return value === null ? null : [m[1] === "-" ? -value : value, unitKey(m[3])];
  }

  // '2.000"', '1.998', '.5 in', '10 V', '1/2"' -> the number; anything else ('0" - 1"', N/A, blank) -> null
  function parseMeasurement(text) {
    const parts = measurementParts(text);
    return parts ? parts[0] : null;
  }

  // An Acceptable Deviation -> {plus, minus, unit, percent}; else null (helpers.py parse_deviation)
  function parseDeviation(text) {
    const amount = String.raw`(${FRACTION}|\d+\.?\d*|\.\d+)\s*([^\d\s+\-.\/][^\d\/]*?)?`;
    text = (text || "").trim();
    let sides, m = new RegExp(String.raw`^(?:\+\s*\/\s*-|\+-|±)?\s*${amount}$`).exec(text);
    if (m) sides = [[m[1], m[2]], [m[1], m[2]]];
    else {
      m = new RegExp(String.raw`^\+\s*${amount}\s*\/?\s*-\s*${amount}$`).exec(text);
      const reverse = new RegExp(String.raw`^-\s*${amount}\s*\/?\s*\+\s*${amount}$`).exec(text);
      if (m) sides = [[m[1], m[2]], [m[3], m[4]]];
      else if (reverse) sides = [[reverse[3], reverse[4]], [reverse[1], reverse[2]]];
      else return null;
    }
    const plus = number(sides[0][0]), minus = number(sides[1][0]);
    const units = new Set(sides.filter(([, u]) => u).map(([, u]) => unitKey(u)));
    if (plus === null || minus === null || units.size > 1) return null;
    const unit = units.size ? [...units][0] : null;
    return { plus, minus, unit: unit === "%" ? null : unit, percent: unit === "%" };
  }

  function convert(value, unit, to) {
    if (unit === null || to === null || unit === to) return value;
    const have = UNITS[unit] || [unit, 1], want = UNITS[to] || [to, 1];
    return have[0] === want[0] ? value * have[1] / want[1] : null;
  }

  // 'pass' / 'fail' for a reading against the range's size +/- the deviation;
  // null when they can't all be read as numbers, or their units can't be compared
  function toleranceResult(nominalText, readingText, deviation) {
    const nominal = measurementParts(nominalText), reading = measurementParts(readingText);
    if (typeof deviation === "number") deviation = { plus: deviation, minus: deviation, unit: null, percent: false };
    if (deviation === null || deviation === undefined || nominal === null || reading === null) return null;
    const unit = nominal[1] || reading[1] || deviation.unit;
    const size = convert(nominal[0], nominal[1], unit), value = convert(reading[0], reading[1], unit);
    const [plus, minus] = deviation.percent
      ? [Math.abs(nominal[0]) * deviation.plus / 100, Math.abs(nominal[0]) * deviation.minus / 100]
      : [convert(deviation.plus, deviation.unit, unit), convert(deviation.minus, deviation.unit, unit)];
    if ([size, value, plus, minus].includes(null)) return null;
    const slack = 1e-9 * Math.max(1, Math.abs(size));
    return value - size > plus + slack || size - value > minus + slack ? "fail" : "pass";
  }

  // The automatic Pass / Fail for a range: the As Left reading decides when
  // there is one (the tool was adjusted to read correctly), else the As Found
  // (and none while that reading has fewer decimal places than the range)
  function calibrationResult(nominalText, asFoundText, afterAdjText, deviation) {
    const reading = parseMeasurement(afterAdjText) !== null ? afterAdjText : asFoundText;
    if (readingTooShort(nominalText, reading)) return null;
    return toleranceResult(nominalText, reading, deviation);
  }

  // '2.000"' -> 3, '2.0' -> 1, '2' -> 0; null if it isn't one number
  function decimalPlaces(text) {
    if (parseMeasurement(text) === null || text.includes("/")) return null;     // (a fraction: none)
    const m = /\.(\d*)/.exec(text);
    return m ? m[1].length : 0;
  }

  // The decimal places a reading needs when it has fewer than its range
  // (range 2.000": '2.00' -> 3); null when it's fine. More is always fine;
  // N/A, text and '0" - 1"' ranges aren't checked
  function readingTooShort(nominalText, readingText) {
    const needed = decimalPlaces(nominalText), typed = decimalPlaces(readingText);
    return needed !== null && typed !== null && typed < needed ? needed : null;
  }

  function outOfTolerance(nominalText, readingText, deviation) {
    return toleranceResult(nominalText, readingText, deviation) === "fail";
  }

  // How far a reading outside the tolerance is past its limit, in words (helpers.py past_limit):
  // '.0009" over the limit' (the reading's decimal places, the range's unit); turns as
  // '1/4 turn over the limit' (a fraction when the reading is one). null when within, or unclear
  function pastLimit(nominalText, readingText, deviation) {
    if (toleranceResult(nominalText, readingText, deviation) !== "fail") return null;
    const nominal = measurementParts(nominalText), reading = measurementParts(readingText);
    if (typeof deviation === "number") deviation = { plus: deviation, minus: deviation, unit: null, percent: false };
    const unit = nominal[1] || reading[1] || deviation.unit;
    const size = convert(nominal[0], nominal[1], unit), value = convert(reading[0], reading[1], unit);
    const [plus, minus] = deviation.percent
      ? [Math.abs(nominal[0]) * deviation.plus / 100, Math.abs(nominal[0]) * deviation.minus / 100]
      : [convert(deviation.plus, deviation.unit, unit), convert(deviation.minus, deviation.unit, unit)];
    const [amount, side] = value > size ? [value - size - plus, "over"] : [size - value - minus, "under"];
    if ((UNITS[unit] || [])[0] === "turns") return `${turnsWords(amount, readingText)} ${side} the limit`;
    const places = decimalPlaces(readingText.trim().replace(/"+$/, ""));
    if (places === null) return null;
    const shown = nominalText.trim().replace(/^[\d.\s]+/, "");
    const figure = amount.toFixed(places);
    return `${figure.startsWith("0.") && ["", '"'].includes(shown) ? figure.slice(1) : figure}${shown} ${side} the limit`;
  }

  // 0.25 -> '1/4 turn' for a reading written as a fraction, else '0.25 turn'; 1.5 -> '1-1/2 turns'
  function turnsWords(amount, readingText) {
    let figure;
    if (readingText.includes("/")) {
      let best = [Math.round(amount), 1];            // (the nearest fraction over 64 or less, as Fraction.limit_denominator)
      for (let d = 2; d <= 64; d++)
        if (Math.abs(Math.round(amount * d) / d - amount) < Math.abs(best[0] / best[1] - amount) - 1e-12) best = [Math.round(amount * d), d];
      const whole = Math.floor(best[0] / best[1]), part = best[0] - whole * best[1];
      const gcd = (a, b) => b ? gcd(b, a % b) : a, g = gcd(part, best[1]) || 1;
      figure = [whole ? String(whole) : "", part ? `${part / g}/${best[1] / g}` : ""].filter(Boolean).join("-") || "0";
    } else {
      figure = String(+amount.toFixed(3));
    }
    return `${figure} turn${amount > 1 ? "s" : ""}`;
  }

  // False for a reading box left empty, or with only N/A or a dash in it (helpers.py reading_given)
  function readingGiven(text) {
    return !["", "N/A", "NA", "-", "–", "—"].includes((text || "").trim().toUpperCase().replace(/\.+$/, ""));
  }

  // In an inch range a plain number gets the inch mark: 1.000 -> 1.000"
  function addInchMark(reading, rangeText) {
    if (!(rangeText || "").includes('"')) return reading;
    const text = (reading || "").trim();
    return new RegExp(`^[+-]?${NUMBER}$`).test(text) ? text + '"' : reading;
  }

  // Remarks starting with the word Pass or Fail -> ['pass'/'fail', the rest]; else [null, text]
  function splitLeadingResult(text) {
    const stripped = (text || "").replace(/^\s+/, "");
    for (const word of ["pass", "fail"]) {
      const after = stripped.slice(word.length, word.length + 1);
      if (stripped.toLowerCase().startsWith(word) && !/^\p{L}$/u.test(after)) return [word, stripped.slice(word.length)];
    }
    return [null, text || ""];
  }

  // The remarks after ticking Pass or Fail (or un-ticking: word '')
  function remarksForResult(text, word) {
    const [lead, rest] = splitLeadingResult(text);
    if (word) {
      if (lead) return word + rest;
      return text.trim() ? `${word} - ${text.trim()}` : word;
    }
    return lead ? rest.replace(/^[ -]+/, "") : text;
  }

  // ---------- dates (ISO 'YYYY-MM-DD' strings, like the database) ----------
  function iso(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseIso(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
  }

  function addMonths(d, months) {
    const index = d.getMonth() + months;
    const year = d.getFullYear() + Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12;
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(d.getDate(), last));
  }

  function intervalIsNever(text) {
    return (text || "").trim().toLowerCase() === "never";
  }

  // The next due date (ISO) from a start date (ISO) and the tool's
  // Calibration Interval; '' for 'Never'; unclear intervals: 3 months
  function dueFromInterval(startIso, intervalText) {
    const start = parseIso(startIso);
    if (!start) return "";
    if (intervalIsNever(intervalText)) return "";
    const text = (intervalText || "").trim().toLowerCase().replace(/\.+$/, "");
    const named = { monthly: 1, quarterly: 3, "semi-annually": 6, semiannually: 6, annually: 12, annual: 12, yearly: 12 };
    if (text in named) return iso(addMonths(start, named[text]));
    const m = /^(\d+)\s*(days?|d|weeks?|wks?|w|months?|mos?|m|years?|yrs?|y)$/.exec(text);
    if (m) {
      const n = parseInt(m[1], 10), unit = m[2][0];
      if (unit === "d" && n >= 1 && n <= 3650) return iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + n));
      if (unit === "w" && n >= 1 && n <= 520) return iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n));
      if (unit === "m" && n >= 1 && n <= 120) return iso(addMonths(start, n));
      if (unit === "y" && n >= 1 && n <= 10) return iso(addMonths(start, 12 * n));
    }
    return iso(addMonths(start, 3));
  }

  function today() {
    return iso(new Date());
  }

  return { parseMeasurement, parseDeviation, toleranceResult, calibrationResult, decimalPlaces, readingTooShort, outOfTolerance, pastLimit, readingGiven, addInchMark, splitLeadingResult,
           remarksForResult, intervalIsNever, dueFromInterval, parseIso, today };
})();
