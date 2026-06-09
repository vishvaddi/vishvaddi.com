(function () {
  var QUOTES = [
    "Prevention beats repair.",
    "Make the right thing the easy thing.",
    "A small system used daily beats a perfect system ignored.",
    "Clarity is a safety feature.",
    "The body is infrastructure. Maintain it.",
    "Write it down before memory edits the facts.",
    "Useful tools remove decisions, not judgment.",
    "Redundancy is boring until the primary fails.",
    "Measure once more before you cut once.",
    "Keep the route home simple.",
    "A calm checklist beats a clever panic.",
    "Capability compounds quietly.",
    "Good defaults prevent bad days.",
    "If it matters, make it inspectable.",
    "Practice is cheaper than improvising under pressure.",
    "A map beats hope.",
    "The first tool is attention.",
    "Small margins become large outcomes.",
    "Design for tired you.",
    "What you maintain is what you own."
  ];
  var target = document.getElementById("site-quote-text");
  if (!target) return;
  var last = Number(sessionStorage.getItem("site_quote_index") || "-1");
  var next = Math.floor(Math.random() * QUOTES.length);
  if (QUOTES.length > 1) {
    while (next === last) next = Math.floor(Math.random() * QUOTES.length);
  }
  sessionStorage.setItem("site_quote_index", String(next));
  target.textContent = QUOTES[next];
})();
