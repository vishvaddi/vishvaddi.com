(function () {
  var input = document.getElementById("calc-note");
  var output = document.getElementById("calc-results");
  var copy = document.getElementById("copy-results");
  var clear = document.getElementById("clear-note");
  if (!input || !output) return;

  var STORE_KEY = "site-calc-notepad";
  var UNIT_ALIASES = {
    "mm": "mm", "millimetre": "mm", "millimetres": "mm",
    "m": "m", "metre": "m", "metres": "m",
    "m2": "m2", "sqm": "m2", "sq m": "m2", "square metre": "m2", "square metres": "m2",
    "m3": "m3", "cum": "m3", "cubic metre": "m3", "cubic metres": "m3",
  };

  function normaliseName(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "";
    var rounded = Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4);
    return rounded.replace(/\.?0+$/, "");
  }

  function formatValue(v) {
    if (!v || !Number.isFinite(v.value)) return "";
    var n = formatNumber(v.value);
    if (v.unit === "$") return "$" + Number(v.value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n + (v.unit ? " " + v.unit : "");
  }

  function cleanExpression(line, vars) {
    var expr = line
      .replace(/,/g, "")
      .replace(/\bplus\s+gst\b/gi, "* 1.1")
      .replace(/\+\s*10%\s*gst\b/gi, "* 1.1")
      .replace(/\bgst\b/gi, "")
      .replace(/\$/g, "")
      .replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");

    Object.keys(vars)
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (key) {
        var re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
        expr = expr.replace(re, String(vars[key].value));
      });

    expr = expr.replace(/\b([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)*)\b/gi, function (match) {
      var key = normaliseName(match);
      if (vars[key]) return String(vars[key].value);
      if (UNIT_ALIASES[match.toLowerCase()]) return "";
      return match;
    });

    return expr;
  }

  function detectUnit(line, vars) {
    if (/\$/.test(line)) return "$";
    var lowered = line.toLowerCase();
    var keys = Object.keys(UNIT_ALIASES).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var re = new RegExp("(^|[^a-z0-9])" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i");
      if (re.test(lowered)) return UNIT_ALIASES[key];
    }
    var names = Object.keys(vars || {}).sort(function (a, b) { return b.length - a.length; });
    for (var j = 0; j < names.length; j++) {
      var name = names[j];
      if (!vars[name].unit) continue;
      var plain = name.replace(/_/g, "\\s+");
      var nameRe = new RegExp("\\b(" + name + "|" + plain + ")\\b", "i");
      if (nameRe.test(lowered)) return vars[name].unit;
    }
    return "";
  }

  function evaluateMath(expr) {
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) throw new Error("Can't parse");
    return Function("\"use strict\"; return (" + expr + ");")();
  }

  function evaluateLine(line, vars) {
    var raw = line.trim();
    if (!raw) return { text: "" };
    var assignment = raw.match(/^([^=]+?)\s*=\s*(.+)$/);
    var name = assignment ? normaliseName(assignment[1]) : "";
    var exprSource = assignment ? assignment[2] : raw;
    var unit = detectUnit(exprSource, vars);
    var expr = cleanExpression(exprSource, vars);
    var value = evaluateMath(expr);
    if (!Number.isFinite(value)) throw new Error("No result");
    var result = { value: value, unit: unit };
    if (name) vars[name] = result;
    return { text: formatValue(result), value: result };
  }

  function render() {
    var vars = {};
    var lines = input.value.split(/\r?\n/);
    output.textContent = "";
    lines.forEach(function (line) {
      var row = document.createElement("div");
      row.className = "note-result";
      try {
        var result = evaluateLine(line, vars);
        row.textContent = result.text;
        if (result.text) row.classList.add("ok");
      } catch (e) {
        row.textContent = line.trim() ? "?" : "";
        if (line.trim()) row.classList.add("err");
      }
      output.appendChild(row);
    });
    try { localStorage.setItem(STORE_KEY, input.value); } catch (_) {}
  }

  try {
    var saved = localStorage.getItem(STORE_KEY);
    if (saved) input.value = saved;
  } catch (_) {}

  input.addEventListener("input", render);
  copy?.addEventListener("click", function () {
    var lines = input.value.split(/\r?\n/);
    var results = Array.prototype.slice.call(output.querySelectorAll(".note-result")).map(function (row) {
      return row.textContent || "";
    });
    var text = lines.map(function (line, i) { return results[i] ? line + " = " + results[i] : line; }).join("\n");
    navigator.clipboard?.writeText(text);
  });
  clear?.addEventListener("click", function () {
    if (!confirm("Clear the notepad?")) return;
    input.value = "";
    render();
  });
  render();
})();
