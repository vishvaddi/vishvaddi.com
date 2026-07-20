// Big 2 roguelike: single player vs three local AI opponents.
(function () {
  var SUITS = ["♦", "♣", "♥", "♠"];
  var RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" };
  var AI_NAMES = ["", "Auntie", "Uncle", "Cousin"];
  var MODE_LABELS = {
    standard: ["Standard Big 2", "A clean single-deal game against three AI opponents."],
    roguelike: ["Roguelike Big 2", "A 12-table run with targets, wagers, Charms, Mastery and Markets."],
    daily: ["Daily Roguelike", "Same seeded roguelike run for everyone today."]
  };
  var TABLES_PER_RUN = 12;
  var MAX_CHARMS = 5;
  var COMBO_SCORE = {
    "Single": 5,
    "Pair": 16,
    "Triple": 30,
    "Straight": 58,
    "Flush": 68,
    "Full house": 88,
    "Four of a kind": 120,
    "Straight flush": 180
  };
  var COMBO_TYPES = Object.keys(COMBO_SCORE);
  var $ = function (id) { return document.getElementById(id); };
  if (!$("b2-hand")) return;

  // Procedural WebAudio SFX — no asset files, lazy context unlocked on first gesture.
  var Sound = (function () {
    var ctx = null;
    var master = null;
    var noiseBuf = null;
    var muted = false;
    try { muted = localStorage.getItem("vv_big2_muted") === "1"; } catch (_) {}

    function ensure() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 0.4);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    function tone(freq, start, dur, type, gain, glideTo) {
      var t0 = ctx.currentTime + start;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.25, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }

    function noise(start, dur, filterFreq, gain) {
      var t0 = ctx.currentTime + start;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      var f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = filterFreq || 2000; f.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.03);
    }

    var recipes = {
      select: function () { tone(880, 0, 0.06, "triangle", 0.16); },
      deselect: function () { tone(560, 0, 0.06, "triangle", 0.12); },
      deal: function () { noise(0, 0.09, 3200, 0.16); noise(0.06, 0.07, 2500, 0.1); },
      play: function () { noise(0, 0.08, 1700, 0.2); tone(300, 0, 0.1, "sine", 0.13, 170); },
      pass: function () { tone(200, 0, 0.14, "sine", 0.13, 140); },
      invalid: function () { tone(160, 0, 0.12, "square", 0.1, 120); tone(150, 0.05, 0.1, "square", 0.09); },
      trick: function () { tone(523, 0, 0.14, "triangle", 0.16); tone(784, 0.08, 0.18, "triangle", 0.14); },
      coin: function () { tone(1320, 0, 0.05, "square", 0.1); tone(1760, 0.04, 0.08, "square", 0.09); },
      tableClear: function () { [523, 659, 784, 1047].forEach(function (fr, i) { tone(fr, i * 0.07, 0.2, "triangle", 0.15); }); },
      win: function () { [523, 659, 784, 1047, 1319].forEach(function (fr, i) { tone(fr, i * 0.09, 0.3, "triangle", 0.17); }); },
      lose: function () { tone(330, 0, 0.4, "sine", 0.16, 110); tone(220, 0.12, 0.5, "sine", 0.13, 90); }
    };

    return {
      play: function (name) {
        if (muted) return;
        ensure();
        if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume();
        var recipe = recipes[name];
        if (recipe) { try { recipe(); } catch (_) {} }
      },
      toggle: function () {
        muted = !muted;
        try { localStorage.setItem("vv_big2_muted", muted ? "1" : "0"); } catch (_) {}
        if (!muted) this.play("select");
        return muted;
      },
      isMuted: function () { return muted; }
    };
  })();

  function sfx(name) { Sound.play(name); }
  function haptic(ms) {
    if (navigator.vibrate && !Sound.isMuted()) { try { navigator.vibrate(ms); } catch (_) {} }
  }

  var CHARM_LIBRARY = [
    { id: "dragonPair", name: "Dragon Pair", kind: "Charm", price: 7, text: "Pairs score +40%.", build: "Pair" },
    { id: "redEnvelope", name: "Red Envelope", kind: "Charm", price: 6, text: "Each diamond you play adds +6 score.", build: "Suit" },
    { id: "auntieLedger", name: "Auntie's Ledger", kind: "Charm", price: 8, text: "If you pass at least twice and clear the table, gain +3 coins.", build: "Economy" },
    { id: "luckyTwo", name: "Lucky Two", kind: "Charm", price: 8, text: "Each 2 you play adds +20 score and +1 coin.", build: "High card" },
    { id: "straightRoad", name: "Straight Road", kind: "Charm", price: 7, text: "Straights score +35.", build: "Five-card" },
    { id: "jadeFan", name: "Jade Fan", kind: "Charm", price: 9, text: "Flushes and straight flushes score +45%.", build: "Flush" },
    { id: "houseBlessing", name: "House Blessing", kind: "Charm", price: 9, text: "Full houses score +45.", build: "Full house" },
    { id: "monkeyKing", name: "Monkey King", kind: "Charm", price: 11, text: "Four-of-a-kind and straight flushes score +80.", build: "Rare hand" },
    { id: "Street Hawker", name: "Street Hawker", kind: "Charm", price: 6, text: "Playing 4+ singles in a table adds +50 score.", build: "Single" },
    { id: "Gambler Bell", name: "Gambler Bell", kind: "Charm", price: 10, text: "Wager rewards are 25% stronger.", build: "Wager" }
  ];

  var BOSS_RULES = [
    { id: "house", name: "House table", text: "Beat the target to reach the Market." },
    { id: "pairLock", name: "Pair Lock", text: "Pairs cannot be played at this Boss table." },
    { id: "twoTax", name: "Two Tax", text: "Playing a 2 adds score, but raises this table target." },
    { id: "fiveCardFestival", name: "Five-Card Festival", text: "Five-card hands score double. Singles score half." },
    { id: "lastTrick", name: "Last Trick", text: "Final table: only a clear win beats the run target." }
  ];

  var WAGERS = [
    { id: "safe", name: "Safe table", text: "No extra risk.", target: 1, reward: 1, rare: 0 },
    { id: "double", name: "Double Pot", text: "+35% target. +50% table score and +3 coins if cleared.", target: 1.35, reward: 1.5, coins: 3, rare: 0 },
    { id: "showdown", name: "Showdown", text: "+25% target. Five-card hands score double.", target: 1.25, reward: 1.15, rare: 0.08 },
    { id: "marketHeat", name: "Market Heat", text: "+20% target. Next Market has better rare odds.", target: 1.2, reward: 1, rare: 0.16 }
  ];

  var hands;
  var pile;
  var current;
  var lastPlayer;
  var passes;
  var selected;
  var over;
  var round = 0;
  var gameId = 0;
  var aiTimer = null;
  var stats = loadStats();
  var mode = "standard";
  var seededState = 1;
  var run;
  var tableStats;
  var marketItems = [];
  var marketRerolls = 0;
  var handCardEls = {};
  var pileCardEls = {};
  var oppEls = null;

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // FLIP: measure persistent elements before `mutate`, then transition them from
  // their old box to the new one. Selection clicks don't reorder, so dx/dy is 0
  // and nothing animates; sort/deal reflows do.
  function slideFrom(el, dx, dy, dur) {
    if (!dx && !dy) return;
    el.style.transition = "none";
    el.style.transform = "translate(" + dx + "px," + dy + "px)";
    el.getBoundingClientRect();
    el.style.transition = "transform " + (dur || 0.3) + "s var(--ease, ease)";
    el.style.transform = "";
    var done = function () {
      el.style.transition = "";
      el.style.transform = "";
      el.removeEventListener("transitionend", done);
    };
    el.addEventListener("transitionend", done);
  }

  function flip(els, mutate) {
    if (prefersReducedMotion() || !els.length) { mutate(); return; }
    var first = new Map();
    els.forEach(function (el) { if (el.isConnected) first.set(el, el.getBoundingClientRect()); });
    mutate();
    els.forEach(function (el) {
      if (!el.isConnected || !first.has(el)) return;
      var f = first.get(el);
      var l = el.getBoundingClientRect();
      slideFrom(el, f.left - l.left, f.top - l.top, 0.3);
    });
  }

  // Record where played cards start (hand card for the player, opponent box for AI)
  // so renderPile can fly the new pile cards in from source.
  var pendingFlight = null;
  function captureFlight(player, cards) {
    if (prefersReducedMotion()) { pendingFlight = null; return; }
    var from = {};
    if (player === 0) {
      cards.forEach(function (card) {
        var el = handCardEls[cardValue(card)];
        if (el && el.isConnected) from[cardValue(card)] = el.getBoundingClientRect();
      });
    } else if (oppEls && oppEls[player - 1]) {
      var rect = oppEls[player - 1].box.getBoundingClientRect();
      cards.forEach(function (card) { from[cardValue(card)] = rect; });
    }
    pendingFlight = { from: from };
  }

  function floatScore(text, big) {
    if (prefersReducedMotion()) return;
    var pileEl = $("b2-pile");
    if (!pileEl) return;
    var rect = pileEl.getBoundingClientRect();
    var el = document.createElement("div");
    el.className = "b2-float" + (big ? " big" : "");
    el.textContent = text;
    el.style.left = (rect.left + rect.width / 2) + "px";
    el.style.top = (rect.top + 6) + "px";
    document.body.appendChild(el);
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1100);
  }

  function updateLiveBadge() {
    var el = $("b2-live-badge");
    if (!el) return;
    el.textContent = "Table points · " + (tableStats.livePoints || 0).toLocaleString();
  }

  function shake() {
    if (prefersReducedMotion()) return;
    var el = $("big2");
    if (!el) return;
    el.classList.remove("b2-shake");
    void el.offsetWidth;
    el.classList.add("b2-shake");
  }

  function resetBoards() {
    handCardEls = {};
    pileCardEls = {};
    var hand = $("b2-hand");
    var pileBoard = $("b2-pile");
    if (hand) hand.textContent = "";
    if (pileBoard) pileBoard.textContent = "";
  }

  function freshRun(daily) {
    return {
      table: 1,
      score: 0,
      coins: 6,
      charms: [],
      mastery: COMBO_TYPES.reduce(function (map, type) { map[type] = 0; return map; }, {}),
      activeWager: "safe",
      rareBonus: 0,
      state: "playing",
      daily: Boolean(daily),
      seed: daily ? dailySeed() : Math.floor(Math.random() * 2147483647),
      bestScore: loadBestScore()
    };
  }

  function freshTableStats() {
    return {
      started: false,
      playerPlays: [],
      comboCounts: {},
      diamondCards: 0,
      twosPlayed: 0,
      playerPasses: 0,
      tricksWon: 0,
      livePoints: 0,
      score: 0,
      coins: 0
    };
  }

  function loadStats() {
    try {
      var saved = JSON.parse(localStorage.getItem("vv_big2_record") || "{}");
      return { wins: Number(saved.wins) || 0, losses: Number(saved.losses) || 0 };
    } catch (_) {
      return { wins: 0, losses: 0 };
    }
  }

  function saveStats() {
    try { localStorage.setItem("vv_big2_record", JSON.stringify(stats)); } catch (_) {}
  }

  function loadBestScore() {
    try { return Number(localStorage.getItem("vv_big2_best_run")) || 0; } catch (_) { return 0; }
  }

  function saveBestScore() {
    if (run.score <= run.bestScore) return;
    run.bestScore = run.score;
    try { localStorage.setItem("vv_big2_best_run", String(run.bestScore)); } catch (_) {}
  }

  function isRogueMode() {
    return mode === "roguelike" || mode === "daily";
  }

  function dailySeed() {
    var key = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return Number(key) || 1;
  }

  function seededRandom() {
    seededState |= 0;
    seededState = (seededState + 0x6D2B79F5) | 0;
    var value = seededState;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  function rand() {
    return isRogueMode() ? seededRandom() : Math.random();
  }

  function label(rank) { return RANK_LABEL[rank] || String(rank); }
  function cardName(card) { return label(card.r) + SUITS[card.s]; }
  function cardValue(card) { return card.r * 4 + card.s; }
  function isRed(card) { return card.s === 0 || card.s === 2; }
  function playerName(player) { return player === 0 ? "You" : AI_NAMES[player]; }
  function hasCharm(id) { return run.charms.indexOf(id) >= 0; }
  function wager() { return WAGERS.filter(function (item) { return item.id === run.activeWager; })[0] || WAGERS[0]; }

  function newDeck() {
    var deck = [];
    var rank;
    var suit;
    for (rank = 3; rank <= 15; rank++) {
      for (suit = 0; suit < 4; suit++) deck.push({ r: rank, s: suit });
    }
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var temp = deck[i];
      deck[i] = deck[j];
      deck[j] = temp;
    }
    return deck;
  }

  function sortHand(hand) {
    hand.sort(function (a, b) { return cardValue(a) - cardValue(b); });
  }

  function classify(cards) {
    var count = cards.length;
    if (!count) return null;
    var sorted = cards.slice().sort(function (a, b) { return cardValue(a) - cardValue(b); });
    var top = sorted[count - 1];

    if (count === 1) return { count: 1, cat: 0, key: cardValue(top), name: "Single" };
    if (count === 2) {
      return sorted[0].r === sorted[1].r
        ? { count: 2, cat: 0, key: cardValue(top), name: "Pair" }
        : null;
    }
    if (count === 3) {
      return sorted[0].r === sorted[1].r && sorted[1].r === sorted[2].r
        ? { count: 3, cat: 0, key: sorted[0].r, name: "Triple" }
        : null;
    }
    if (count !== 5) return null;

    var ranks = {};
    sorted.forEach(function (card) { ranks[card.r] = (ranks[card.r] || 0) + 1; });
    var counts = Object.keys(ranks).map(function (key) { return ranks[key]; }).sort();
    var flush = sorted.every(function (card) { return card.s === sorted[0].s; });
    var straight = Object.keys(ranks).length === 5 && sorted[4].r - sorted[0].r === 4;

    if (straight && flush) return { count: 5, cat: 4, key: cardValue(top), name: "Straight flush" };
    if (counts[counts.length - 1] === 4) {
      var quad = Number(Object.keys(ranks).filter(function (key) { return ranks[key] === 4; })[0]);
      return { count: 5, cat: 3, key: quad, name: "Four of a kind" };
    }
    if (counts.length === 2 && counts[0] === 2) {
      var trip = Number(Object.keys(ranks).filter(function (key) { return ranks[key] === 3; })[0]);
      return { count: 5, cat: 2, key: trip, name: "Full house" };
    }
    if (flush) return { count: 5, cat: 1, key: cardValue(top), name: "Flush" };
    if (straight) return { count: 5, cat: 0, key: cardValue(top), name: "Straight" };
    return null;
  }

  function beats(candidate, target) {
    if (!candidate) return false;
    if (!target) return true;
    if (candidate.count !== target.count) return false;
    return candidate.cat > target.cat || (candidate.cat === target.cat && candidate.key > target.key);
  }

  function hasStartCard(cards) {
    return cards.some(function (card) { return card.r === 3 && card.s === 0; });
  }

  function isFirstTrick() {
    return hands.reduce(function (total, hand) { return total + hand.length; }, 0) === 52;
  }

  function bossRule() {
    if (!isRogueMode()) return BOSS_RULES[0];
    if (run.table === TABLES_PER_RUN) return BOSS_RULES[4];
    if (run.table % 3 !== 0) return BOSS_RULES[0];
    return BOSS_RULES[((run.table / 3 - 1) % 3) + 1];
  }

  function baseTarget() {
    return Math.round((105 + run.table * 35 + Math.pow(run.table, 1.32) * 16) / 5) * 5;
  }

  function tableTarget() {
    var target = baseTarget() * wager().target;
    if (bossRule().id === "twoTax") target += tableStats.twosPlayed * 18;
    if (bossRule().id === "lastTrick") target *= 1.2;
    return Math.round(target / 5) * 5;
  }

  function tableAllows(combo) {
    if (!combo) return false;
    if (isRogueMode() && bossRule().id === "pairLock" && combo.name === "Pair") return false;
    return true;
  }

  function combos(hand) {
    var output = [];
    var i;
    var j;
    var k;
    var m;
    var p;

    for (i = 0; i < hand.length; i++) output.push([hand[i]]);

    var byRank = {};
    hand.forEach(function (card) { (byRank[card.r] = byRank[card.r] || []).push(card); });
    Object.keys(byRank).forEach(function (rank) {
      var group = byRank[rank];
      if (group.length >= 2) {
        for (i = 0; i < group.length; i++) {
          for (j = i + 1; j < group.length; j++) output.push([group[i], group[j]]);
        }
      }
      if (group.length >= 3) {
        for (i = 0; i < group.length; i++) {
          for (j = i + 1; j < group.length; j++) {
            for (k = j + 1; k < group.length; k++) output.push([group[i], group[j], group[k]]);
          }
        }
      }
    });

    for (i = 0; i < hand.length; i++) {
      for (j = i + 1; j < hand.length; j++) {
        for (k = j + 1; k < hand.length; k++) {
          for (m = k + 1; m < hand.length; m++) {
            for (p = m + 1; p < hand.length; p++) {
              var set = [hand[i], hand[j], hand[k], hand[m], hand[p]];
              if (classify(set)) output.push(set);
            }
          }
        }
      }
    }
    return output;
  }

  function candidatePlays(hand) {
    return combos(hand).map(function (set) {
      return { set: set, combo: classify(set) };
    }).filter(function (candidate) {
      return tableAllows(candidate.combo);
    });
  }

  function legalPlays(hand) {
    return candidatePlays(hand).filter(function (candidate) {
      if (isFirstTrick() && !hasStartCard(candidate.set)) return false;
      return !pile || beats(candidate.combo, pile.combo);
    });
  }

  function orderedLegalPlays(hand) {
    return legalPlays(hand).sort(function (a, b) {
      return a.combo.count - b.combo.count ||
        a.combo.cat - b.combo.cat ||
        a.combo.key - b.combo.key;
    });
  }

  function quickMoveOptions() {
    var seen = {};
    return orderedLegalPlays(hands[0]).filter(function (candidate) {
      var key = candidate.combo.name;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 6);
  }

  function containsTwo(set) {
    return set.some(function (card) { return card.r === 15; });
  }

  function chooseLead(candidates, player) {
    var pool = candidates.slice();
    if (isFirstTrick()) pool = pool.filter(function (candidate) { return hasStartCard(candidate.set); });
    if (!pool.length) return null;

    pool.sort(function (a, b) {
      return a.combo.count - b.combo.count ||
        a.combo.cat - b.combo.cat ||
        a.combo.key - b.combo.key;
    });

    if (player === 1 && hands[player].length > 4) {
      var withoutTwos = pool.filter(function (candidate) { return !containsTwo(candidate.set); });
      if (withoutTwos.length) return withoutTwos[0];
    }
    if (player === 2 && hands[player].length <= 5) return pool[pool.length - 1];
    if (player === 3 && pool.length > 2 && rand() < 0.35) return pool[Math.floor(rand() * Math.min(3, pool.length))];
    return pool[0];
  }

  function chooseResponse(candidates, player) {
    var beating = candidates.filter(function (candidate) { return pile && beats(candidate.combo, pile.combo); });
    beating.sort(function (a, b) {
      return a.combo.cat - b.combo.cat || a.combo.key - b.combo.key;
    });
    if (!beating.length) return null;

    if (player === 1 && hands[player].length > 4) {
      var cheap = beating.filter(function (candidate) { return !containsTwo(candidate.set); });
      if (cheap.length) return cheap[0];
    }
    if (player === 2 && hands[player].length <= 5) return beating[beating.length - 1];
    if (player === 3 && beating.length > 1 && rand() < 0.3) {
      return beating[Math.floor(rand() * Math.min(3, beating.length))];
    }
    return beating[0];
  }

  function selectionState() {
    var cards = selectedCards();
    var combo = classify(cards);
    if (!cards.length) return { valid: false, text: hands[0].length + " cards remaining" };
    if (!combo) return { valid: false, text: "Not a legal combination" };
    if (!tableAllows(combo)) return { valid: false, text: combo.name + " blocked by " + bossRule().name };
    if (isFirstTrick() && !hasStartCard(cards)) {
      return { valid: false, text: combo.name + " · must include 3♦" };
    }
    if (pile && !beats(combo, pile.combo)) {
      return { valid: false, text: combo.name + " · does not beat " + pile.combo.name.toLowerCase() };
    }
    return { valid: true, text: combo.name + " · ready to play" };
  }

  function render() {
    $("big2").dataset.mode = mode === "standard" ? "standard" : "roguelike";
    $("b2-mode-title").textContent = MODE_LABELS[mode][0];
    $("b2-mode-copy").textContent = MODE_LABELS[mode][1];
    document.querySelectorAll("[data-b2-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.b2Mode === mode);
    });
    $("b2-round").textContent = isRogueMode()
      ? "Deal " + round + " · Best run " + run.bestScore + (mode === "daily" ? " · Daily " + run.seed : "")
      : "Round " + round;
    $("b2-record").textContent = stats.wins + " wins · " + stats.losses + " losses";
    $("b2-turn").textContent = over ? (isRogueMode() ? "Table finished" : "Round finished") : playerName(current);
    $("b2-target").textContent = pile
      ? pile.combo.name + " · " + pile.cards.map(cardName).join(" ")
      : "Open lead";

    if (isRogueMode()) {
      $("b2-run-score").textContent = run.score.toLocaleString();
      $("b2-table-target").textContent = tableTarget().toLocaleString();
      $("b2-coins").textContent = run.coins;
      $("b2-table-no").textContent = Math.min(run.table, TABLES_PER_RUN) + " / " + TABLES_PER_RUN;
      $("b2-table-rule").textContent = bossRule().name;
      $("b2-table-rule-copy").textContent = bossRule().text;
      $("b2-wager-name").textContent = wager().name;
      $("b2-wager-copy").textContent = wager().text;
      renderWagers();
      renderCharms();
      updateLiveBadge();
    }
    $("b2-new").textContent = isRogueMode() ? "New run" : "New deal";

    renderOpponents();
    renderPile();
    renderHand();

    var state = selectionState();
    $("b2-selection").textContent = state.text;
    $("b2-selection").classList.toggle("valid", state.valid);
    $("b2-selection").classList.toggle("invalid", selected.length > 0 && !state.valid);
    $("b2-play").disabled = current !== 0 || over || !state.valid;
    $("b2-pass").disabled = current !== 0 || over || !pile;
    $("b2-hint").disabled = current !== 0 || over;
    $("b2-clear").disabled = current !== 0 || over || !selected.length;
    renderQuickMoves();
  }

  function renderWagers() {
    var root = $("b2-wagers");
    root.textContent = "";
    var wagerLocked = tableStats.playerPlays.length > 0 || tableStats.playerPasses > 0 || over;
    WAGERS.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "b2-wager" + (run.activeWager === item.id ? " active" : "");
      button.textContent = item.name;
      button.disabled = wagerLocked;
      button.addEventListener("click", function () {
        if (wagerLocked) return;
        run.activeWager = item.id;
        render();
        message(item.name + " selected.");
      });
      root.appendChild(button);
    });
  }

  function renderCharms() {
    var root = $("b2-charms");
    root.textContent = "";
    if (!run.charms.length) {
      var empty = document.createElement("span");
      empty.className = "b2-charm-chip";
      empty.textContent = "No charms yet. Clear a table to visit the Market.";
      root.appendChild(empty);
      return;
    }
    run.charms.forEach(function (id) {
      var charm = CHARM_LIBRARY.filter(function (item) { return item.id === id; })[0];
      var chip = document.createElement("span");
      chip.className = "b2-charm-chip";
      chip.textContent = charm ? charm.name : id;
      root.appendChild(chip);
    });
  }

  function renderQuickMoves() {
    var target = $("b2-quick");
    target.textContent = "";
    if (over) {
      var finished = document.createElement("span");
      finished.className = "b2-quick-empty";
      finished.textContent = isRogueMode() ? "Resolve the table to continue the run." : "Start a new deal to play again.";
      target.appendChild(finished);
      return;
    }
    if (current !== 0) {
      var waiting = document.createElement("span");
      waiting.className = "b2-quick-empty";
      waiting.textContent = "Waiting for " + playerName(current) + "...";
      target.appendChild(waiting);
      return;
    }
    var options = quickMoveOptions();
    if (!options.length) {
      var empty = document.createElement("span");
      empty.className = "b2-quick-empty";
      empty.textContent = pile ? "No legal move. Pass the turn." : "No move available.";
      target.appendChild(empty);
      return;
    }
    options.forEach(function (candidate) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "b2-quick-btn";
      button.textContent = candidate.combo.name + " · " + candidate.set.map(cardName).join(" ");
      button.addEventListener("click", function () {
        selected = candidate.set.map(function (card) { return hands[0].indexOf(card); });
        render();
        message(candidate.combo.name + " selected. Press Play selected to confirm.");
      });
      target.appendChild(button);
    });
  }

  function ensureOpponents() {
    if (oppEls) return;
    oppEls = [];
    var root = $("b2-opponents");
    root.textContent = "";
    for (var player = 1; player <= 3; player++) {
      var box = document.createElement("div");
      box.className = "b2-opp";
      var name = document.createElement("div");
      name.className = "b2-opp-name";
      var cards = document.createElement("div");
      cards.className = "b2-opp-cards";
      var backs = document.createElement("div");
      backs.className = "b2-card-backs";
      box.append(name, cards, backs);
      root.appendChild(box);
      oppEls.push({ box: box, name: name, cards: cards, backs: backs });
    }
  }

  function renderOpponents() {
    ensureOpponents();
    for (var player = 1; player <= 3; player++) {
      var refs = oppEls[player - 1];
      refs.box.classList.toggle("turn", current === player);
      refs.name.textContent = AI_NAMES[player] + (current === player ? " · playing" : "");
      refs.cards.textContent = hands[player].length + " cards";
      var want = Math.min(hands[player].length, 10);
      while (refs.backs.children.length > want) refs.backs.removeChild(refs.backs.lastChild);
      while (refs.backs.children.length < want) {
        var backCard = document.createElement("span");
        backCard.className = "b2-card-back";
        refs.backs.appendChild(backCard);
      }
    }
  }

  function renderPile() {
    var pileElement = $("b2-pile");
    if (!pile) {
      pileElement.textContent = "";
      pileCardEls = {};
      $("b2-pile-by").textContent = over ? "" : playerName(current) + " lead";
      return;
    }
    var sorted = pile.cards.slice().sort(function (a, b) { return cardValue(a) - cardValue(b); });
    var seen = {};
    sorted.forEach(function (card) {
      var key = cardValue(card);
      seen[key] = true;
      var el = pileCardEls[key];
      if (!el) {
        el = cardElement(card, false);
        pileCardEls[key] = el;
      }
      pileElement.appendChild(el);
    });
    Object.keys(pileCardEls).forEach(function (key) {
      if (seen[key]) return;
      var el = pileCardEls[key];
      if (el.parentNode) el.parentNode.removeChild(el);
      delete pileCardEls[key];
    });

    if (pendingFlight) {
      sorted.forEach(function (card) {
        var key = cardValue(card);
        var fromRect = pendingFlight.from[key];
        var el = pileCardEls[key];
        if (!fromRect || !el) return;
        var to = el.getBoundingClientRect();
        slideFrom(el, fromRect.left - to.left, fromRect.top - to.top, 0.32);
      });
      pendingFlight = null;
    }

    $("b2-pile-by").textContent = playerName(pile.player) + " played " + pile.combo.name.toLowerCase();
  }

  function onHandCardClick() {
    if (current !== 0 || over) return;
    var index = hands[0].indexOf(this._card);
    if (index < 0) return;
    var at = selected.indexOf(index);
    if (at >= 0) { selected.splice(at, 1); sfx("deselect"); }
    else { selected.push(index); sfx("select"); }
    haptic(6);
    render();
  }

  function renderHand() {
    var handElement = $("b2-hand");
    var playableCards = new Set();
    if (current === 0 && !over) {
      legalPlays(hands[0]).forEach(function (candidate) {
        candidate.set.forEach(function (card) { playableCards.add(card); });
      });
    }

    var seen = {};
    var persistent = [];
    hands[0].forEach(function (card) {
      var key = cardValue(card);
      seen[key] = true;
      if (handCardEls[key]) persistent.push(handCardEls[key]);
    });

    flip(persistent, function () {
      hands[0].forEach(function (card, index) {
        var key = cardValue(card);
        var el = handCardEls[key];
        if (!el) {
          el = cardElement(card, true);
          el._card = card;
          el.addEventListener("click", onHandCardClick);
          handCardEls[key] = el;
        }
        var isSel = selected.indexOf(index) >= 0;
        el.classList.toggle("sel", isSel);
        el.classList.toggle("playable", playableCards.has(card));
        el.setAttribute("aria-pressed", isSel ? "true" : "false");
        handElement.appendChild(el);
      });
      Object.keys(handCardEls).forEach(function (key) {
        if (seen[key]) return;
        var el = handCardEls[key];
        if (el.parentNode) el.parentNode.removeChild(el);
        delete handCardEls[key];
      });
    });
  }

  function cardElement(card, selectable) {
    var element = document.createElement(selectable ? "button" : "div");
    if (selectable) element.type = "button";
    element.className = "b2-card" + (isRed(card) ? " red" : "") + (selectable ? "" : " sm");
    element.setAttribute("aria-label", cardName(card));

    var rank = document.createElement("span");
    rank.className = "b2-card-rank";
    rank.textContent = label(card.r);
    var suit = document.createElement("span");
    suit.className = "b2-card-suit";
    suit.textContent = SUITS[card.s];
    element.append(rank, suit);
    return element;
  }

  function message(text) {
    $("b2-msg").textContent = text;
  }

  function clearAITimer() {
    if (aiTimer !== null) window.clearTimeout(aiTimer);
    aiTimer = null;
  }

  function scheduleAI(delay) {
    clearAITimer();
    var token = gameId;
    var expectedPlayer = current;
    aiTimer = window.setTimeout(function () {
      aiTimer = null;
      if (token !== gameId || over || current !== expectedPlayer || current === 0) return;
      aiTurn();
    }, delay || 650);
  }

  function scoreCombo(combo, cards) {
    var value = COMBO_SCORE[combo.name] || 0;
    value *= 1 + (run.mastery[combo.name] || 0) * 0.18;
    if (combo.name === "Pair" && hasCharm("dragonPair")) value *= 1.4;
    if ((combo.name === "Flush" || combo.name === "Straight flush") && hasCharm("jadeFan")) value *= 1.45;
    if (combo.name === "Straight" && hasCharm("straightRoad")) value += 35;
    if (combo.name === "Full house" && hasCharm("houseBlessing")) value += 45;
    if ((combo.name === "Four of a kind" || combo.name === "Straight flush") && hasCharm("monkeyKing")) value += 80;
    if (bossRule().id === "fiveCardFestival") value *= combo.count === 5 ? 2 : combo.name === "Single" ? 0.5 : 1;
    if (wager().id === "showdown" && combo.count === 5) value *= 2;
    if (bossRule().id === "twoTax" && cards.some(function (card) { return card.r === 15; })) value += 24;
    return value;
  }

  function scoreTable(winner) {
    if (winner !== 0) return { score: 0, coins: 0, passed: false };
    var score = 50;
    var coins = 3;
    var opponentCards = hands.slice(1).reduce(function (total, hand) { return total + hand.length; }, 0);
    score += opponentCards * 18;
    if (opponentCards >= 12) coins += 2;
    else if (opponentCards >= 7) coins += 1;

    tableStats.playerPlays.forEach(function (entry) {
      score += scoreCombo(entry.combo, entry.cards);
    });
    if (hasCharm("redEnvelope")) score += tableStats.diamondCards * 6;
    if (hasCharm("luckyTwo")) {
      score += tableStats.twosPlayed * 20;
      coins += tableStats.twosPlayed;
    }
    if (hasCharm("Street Hawker") && (tableStats.comboCounts.Single || 0) >= 4) score += 50;
    if (hasCharm("auntieLedger") && tableStats.playerPasses >= 2) coins += 3;

    score *= wager().reward;
    if (hasCharm("Gambler Bell") && wager().id !== "safe") {
      score *= 1.25;
      coins += 1;
    }
    coins += wager().coins || 0;
    score = Math.round(score);
    return { score: score, coins: coins, passed: score >= tableTarget() };
  }

  function finish(player) {
    over = true;
    clearAITimer();
    if (player === 0) stats.wins++;
    else stats.losses++;
    saveStats();

    if (!isRogueMode()) {
      render();
      message(player === 0
        ? "You win with " + hands.slice(1).reduce(function (total, hand) { return total + hand.length; }, 0) + " opponent cards left."
        : AI_NAMES[player] + " wins. You had " + hands[0].length + " cards left.");
      return;
    }

    var result = scoreTable(player);
    tableStats.score = result.score;
    tableStats.coins = result.coins;
    render();

    if (!result.passed) {
      message((player === 0 ? "You cleared the hand" : AI_NAMES[player] + " went out") + ", but the table target held. Run ended at " + run.score.toLocaleString() + ".");
      showRunOver(result);
      return;
    }

    run.score += result.score;
    run.coins += result.coins;
    run.rareBonus += wager().rare || 0;
    saveBestScore();

    if (run.table >= TABLES_PER_RUN) {
      message("Run cleared. Final score " + run.score.toLocaleString() + ".");
      showRunWin(result);
      return;
    }

    message("Table cleared for " + result.score.toLocaleString() + " score and " + result.coins + " coins.");
    showMarket(result);
  }

  function play(player, cards) {
    tableStats.started = true;
    var combo = classify(cards);
    captureFlight(player, cards);
    var hand = hands[player];
    cards.forEach(function (card) { hand.splice(hand.indexOf(card), 1); });
    pile = { cards: cards, combo: combo, player: player };
    lastPlayer = player;
    passes = 0;
    sfx("play");
    var bigHand = combo.count === 5 && combo.cat >= 2;

    if (player === 0) {
      haptic(18);
      tableStats.playerPlays.push({ combo: combo, cards: cards.slice() });
      tableStats.comboCounts[combo.name] = (tableStats.comboCounts[combo.name] || 0) + 1;
      cards.forEach(function (card) {
        if (card.s === 0) tableStats.diamondCards++;
        if (card.r === 15) tableStats.twosPlayed++;
      });
      if (isRogueMode()) {
        var pts = Math.round(scoreCombo(combo, cards));
        tableStats.livePoints += pts;
        floatScore("+" + pts.toLocaleString() + " · " + combo.name, bigHand);
      }
      if (bigHand) shake();
    }

    if (!hand.length) {
      finish(player);
      return;
    }
    advance();
  }

  function pass(player) {
    tableStats.started = true;
    if (player === 0) tableStats.playerPasses++;
    sfx("pass");
    passes++;
    if (passes >= 3) {
      if (lastPlayer === 0) tableStats.tricksWon++;
      sfx("trick");
      pile = null;
      passes = 0;
      current = lastPlayer;
      selected = [];
      message(playerName(current) + " takes the trick and leads again.");
      render();
      if (current !== 0) scheduleAI(700);
      return;
    }
    advance();
  }

  function advance() {
    current = (current + 1) % 4;
    selected = [];
    render();
    if (!over && current !== 0) {
      message(AI_NAMES[current] + " is thinking...");
      scheduleAI(650);
    } else if (!over) {
      message(pile ? "Your turn: beat it or pass." : "Your lead.");
    }
  }

  function aiTurn() {
    var player = current;
    var candidates = legalPlays(hands[player]);
    var choice = pile ? chooseResponse(candidates, player) : chooseLead(candidates, player);
    if (choice) play(player, choice.set);
    else pass(player);
  }

  function selectedCards() {
    return selected.map(function (index) { return hands[0][index]; }).filter(Boolean);
  }

  function playSelection() {
    if (current !== 0 || over) return;
    var state = selectionState();
    if (!state.valid) {
      sfx("invalid");
      message(state.text + ".");
      return;
    }
    var cards = selectedCards();
    selected = [];
    play(0, cards);
  }

  function showHint() {
    if (current !== 0 || over) return;
    var options = legalPlays(hands[0]);
    var choice = pile ? chooseResponse(options, 1) : chooseLead(options, 0);
    if (!choice) {
      selected = [];
      render();
      message("No legal move. Pass.");
      return;
    }
    selected = choice.set.map(function (card) { return hands[0].indexOf(card); });
    render();
    message("A legal " + choice.combo.name.toLowerCase() + " is selected.");
  }

  function deal() {
    gameId++;
    clearAITimer();
    round++;
    if (isRogueMode()) seededState = (run.seed + run.table * 1009 + round * 9176) | 0;
    tableStats = freshTableStats();
    resetBoards();
    sfx("deal");

    var deck = newDeck();
    hands = [[], [], [], []];
    deck.forEach(function (card, index) { hands[index % 4].push(card); });
    hands.forEach(sortHand);
    pile = null;
    passes = 0;
    selected = [];
    over = false;
    lastPlayer = null;

    current = 0;
    for (var player = 0; player < 4; player++) {
      if (hasStartCard(hands[player])) current = player;
    }

    render();
    if (current === 0) {
      message("You hold 3♦. Lead with a combination that includes it.");
    } else {
      message(AI_NAMES[current] + " holds 3♦ and leads.");
      scheduleAI(700);
    }
  }

  function nextTable() {
    hideMarket();
    run.table++;
    run.activeWager = "safe";
    deal();
  }

  function startMode(nextMode) {
    hideMarket();
    mode = nextMode || mode || "standard";
    run = freshRun(mode === "daily");
    round = 0;
    deal();
  }

  function newRun() {
    startMode(mode);
  }

  function newDeal() {
    if (isRogueMode()) newRun();
    else {
      hideMarket();
      deal();
    }
  }

  function charmById(id) {
    return CHARM_LIBRARY.filter(function (item) { return item.id === id; })[0];
  }

  function marketPool() {
    var pool = CHARM_LIBRARY.filter(function (item) { return run.charms.indexOf(item.id) < 0; });
    var focus = [];
    Object.keys(tableStats.comboCounts).forEach(function (combo) {
      focus = focus.concat(pool.filter(function (item) { return item.build.toLowerCase().indexOf(combo.toLowerCase().split(" ")[0]) >= 0; }));
    });
    return focus.concat(pool);
  }

  function rollMarket() {
    var items = [];
    var pool = marketPool();
    while (items.length < 3 && pool.length) {
      var rareBoost = run.rareBonus + marketRerolls * 0.02;
      var index = Math.floor(rand() * pool.length);
      if (rand() < rareBoost) {
        var expensive = pool.slice().sort(function (a, b) { return b.price - a.price; })[0];
        index = pool.indexOf(expensive);
      }
      var charm = pool.splice(index, 1)[0];
      if (!items.some(function (item) { return item.type === "charm" && item.id === charm.id; })) {
        items.push({ type: "charm", id: charm.id, name: charm.name, kind: charm.kind, text: charm.text, price: charm.price });
      }
    }
    var mastery = COMBO_TYPES.slice().sort(function (a, b) {
      var aSeen = tableStats.comboCounts[a] || 0;
      var bSeen = tableStats.comboCounts[b] || 0;
      return bSeen - aSeen || (run.mastery[a] || 0) - (run.mastery[b] || 0) || rand() - 0.5;
    })[0];
    items.push({ type: "mastery", id: mastery, name: mastery + " Mastery", kind: "Training", text: "Raise " + mastery + " scoring from level " + run.mastery[mastery] + " to " + (run.mastery[mastery] + 1) + ".", price: 5 + run.mastery[mastery] * 3 });
    marketItems = items;
  }

  function showMarket(result) {
    sfx("tableClear");
    shake();
    marketRerolls = 0;
    rollMarket();
    $("b2-market-kicker").textContent = "Table " + run.table + " cleared";
    $("b2-market-title").textContent = "Market";
    $("b2-market-copy").textContent = "+" + result.score.toLocaleString() + " score · +" + result.coins + " coins. Spend coins, then face table " + (run.table + 1) + ".";
    $("b2-continue").textContent = "Next table";
    $("b2-reroll").classList.remove("hidden");
    renderMarket();
    $("b2-market").classList.remove("hidden");
  }

  function showRunOver(result) {
    sfx("lose");
    saveBestScore();
    var gap = Math.max(0, tableTarget() - result.score);
    var played = tableStats.playerPlays.map(function (entry) { return entry.combo.name; }).join(", ") || "no scoring plays";
    $("b2-market-kicker").textContent = "Run ended";
    $("b2-market-title").textContent = "Target missed";
    $("b2-market-copy").textContent = "This table scored " + result.score.toLocaleString() + " against a target of " + tableTarget().toLocaleString() + ". Short by " + gap.toLocaleString() + ". You played: " + played + ". Final run score: " + run.score.toLocaleString() + ".";
    $("b2-market-grid").textContent = "";
    $("b2-reroll").classList.add("hidden");
    $("b2-continue").textContent = "New run";
    $("b2-market").classList.remove("hidden");
  }

  function showRunWin(result) {
    sfx("win");
    shake();
    saveBestScore();
    $("b2-market-kicker").textContent = "Run cleared";
    $("b2-market-title").textContent = "You beat the house";
    $("b2-market-copy").textContent = "Final table scored " + result.score.toLocaleString() + ". Final run score: " + run.score.toLocaleString() + ". Charms: " + (run.charms.map(function (id) { return charmById(id)?.name || id; }).join(", ") || "none") + ".";
    $("b2-market-grid").textContent = "";
    $("b2-reroll").classList.add("hidden");
    $("b2-continue").textContent = "New run";
    $("b2-market").classList.remove("hidden");
  }

  function hideMarket() {
    $("b2-market").classList.add("hidden");
  }

  function renderMarket() {
    var grid = $("b2-market-grid");
    grid.textContent = "";
    marketItems.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "b2-shop-card";
      button.disabled = item.bought || run.coins < item.price || (item.type === "charm" && run.charms.length >= MAX_CHARMS);
      button.innerHTML = "<span>" + item.kind + "</span><strong>" + item.name + "</strong><p>" + item.text + "</p><b>" + item.price + " coins</b>";
      button.addEventListener("click", function () {
        buyMarketItem(item);
      });
      grid.appendChild(button);
    });
    $("b2-reroll").textContent = "Reroll market · " + (2 + marketRerolls) + " coins";
    $("b2-reroll").disabled = run.coins < 2 + marketRerolls;
  }

  function buyMarketItem(item) {
    if (item.bought || run.coins < item.price) return;
    if (item.type === "charm" && run.charms.length >= MAX_CHARMS) return;
    sfx("coin");
    run.coins -= item.price;
    item.bought = true;
    if (item.type === "charm") run.charms.push(item.id);
    if (item.type === "mastery") run.mastery[item.id]++;
    $("b2-market-copy").textContent = item.name + " bought. " + run.coins + " coins left.";
    render();
    renderMarket();
  }

  function feedbackPacket() {
    return JSON.stringify({
      game: "Big 2",
      mode: mode,
      round: round,
      record: stats,
      run: isRogueMode() ? {
        table: run.table,
        score: run.score,
        coins: run.coins,
        target: tableTarget(),
        rule: bossRule().name,
        wager: wager().name,
        seed: run.seed,
        charms: run.charms.map(function (id) { return charmById(id)?.name || id; }),
        mastery: run.mastery
      } : null,
      turn: playerName(current),
      pile: pile ? { player: playerName(pile.player), combo: pile.combo.name, cards: pile.cards.map(cardName) } : null,
      playerHand: hands && hands[0] ? hands[0].map(cardName) : [],
      opponents: hands ? hands.slice(1).map(function (hand, index) { return { name: AI_NAMES[index + 1], cards: hand.length }; }) : [],
      message: $("b2-msg").textContent,
      url: location.href,
      userAgent: navigator.userAgent,
      generatedAt: new Date().toISOString()
    }, null, 2);
  }

  function showFeedback() {
    var panel = $("b2-feedback-panel");
    var text = feedbackPacket();
    $("b2-feedback-text").value = text;
    $("b2-mail-feedback").href = "mailto:vishvaddi@gmail.com?subject=Big%202%20feedback&body=" + encodeURIComponent(text);
    panel.classList.remove("hidden");
    panel.open = true;
  }

  $("b2-play").addEventListener("click", playSelection);
  $("b2-pass").addEventListener("click", function () {
    if (current !== 0 || over || !pile) return;
    selected = [];
    render();
    pass(0);
  });
  $("b2-hint").addEventListener("click", showHint);
  $("b2-clear").addEventListener("click", function () {
    if (current !== 0 || over) return;
    selected = [];
    render();
    message("Selection cleared.");
  });
  $("b2-sort").addEventListener("click", function () {
    sortHand(hands[0]);
    selected = [];
    render();
  });
  document.querySelectorAll("[data-b2-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      startMode(button.dataset.b2Mode || "standard");
    });
  });
  $("b2-new").addEventListener("click", newDeal);
  $("b2-feedback").addEventListener("click", showFeedback);
  var soundBtn = $("b2-sound");
  if (soundBtn) {
    var syncSound = function () {
      soundBtn.textContent = Sound.isMuted() ? "Sound: off" : "Sound: on";
      soundBtn.setAttribute("aria-pressed", Sound.isMuted() ? "false" : "true");
    };
    soundBtn.addEventListener("click", function () { Sound.toggle(); syncSound(); });
    syncSound();
  }
  $("b2-copy-feedback").addEventListener("click", function () {
    var text = $("b2-feedback-text").value || feedbackPacket();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        message("Feedback packet copied.");
      }).catch(function () {
        message("Could not copy automatically. Select the packet and copy it manually.");
      });
    } else {
      message("Select the packet and copy it manually.");
    }
  });
  $("b2-reroll").addEventListener("click", function () {
    var cost = 2 + marketRerolls;
    if (run.coins < cost) return;
    run.coins -= cost;
    marketRerolls++;
    rollMarket();
    render();
    renderMarket();
  });
  $("b2-continue").addEventListener("click", function () {
    if (run.table >= TABLES_PER_RUN || over && !$("b2-market-grid").children.length) newRun();
    else nextTable();
  });

  document.addEventListener("keydown", function (event) {
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!$("b2-market").classList.contains("hidden")) {
      if (event.key === "Enter") $("b2-continue").click();
      return;
    }
    if (event.key === "Enter") playSelection();
    else if (event.key.toLowerCase() === "p" && !$("b2-pass").disabled) $("b2-pass").click();
    else if (event.key.toLowerCase() === "h") showHint();
    else if (event.key.toLowerCase() === "s") $("b2-sort").click();
    else if (event.key.toLowerCase() === "n") newDeal();
  });

  startMode("standard");
})();
