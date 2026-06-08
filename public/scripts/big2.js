// Big 2 (Big Two) — single player vs 3 AI. Vanilla JS, no deps.
// Rank order 3<4<...<A<2; suit order ♦<♣<♥<♠. 3♦ leads the first trick.
(function () {
  var SUITS = ["♦", "♣", "♥", "♠"]; // index = suit rank (low→high)
  var RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" };
  var $ = function (id) { return document.getElementById(id); };
  if (!$("b2-hand")) return;

  var hands, pile, current, lastPlayer, passes, selected, over;

  function label(r) { return RANK_LABEL[r] || String(r); }
  function cv(c) { return c.r * 4 + c.s; }
  function red(c) { return c.s === 0 || c.s === 2; }

  function newDeck() {
    var d = [];
    for (var r = 3; r <= 15; r++) for (var s = 0; s < 4; s++) d.push({ r: r, s: s });
    for (var i = d.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = d[i]; d[i] = d[j]; d[j] = t; }
    return d;
  }

  function sortHand(h) { h.sort(function (a, b) { return cv(a) - cv(b); }); }

  // Classify a set of cards into a comparable combo, or null if illegal.
  function classify(cards) {
    var n = cards.length;
    if (n === 0) return null;
    var cs = cards.slice().sort(function (a, b) { return cv(a) - cv(b); });
    var top = cs[n - 1];
    if (n === 1) return { count: 1, cat: 0, key: cv(cs[0]) };
    if (n === 2) return cs[0].r === cs[1].r ? { count: 2, cat: 0, key: cv(top) } : null;
    if (n === 3) return (cs[0].r === cs[1].r && cs[1].r === cs[2].r) ? { count: 3, cat: 0, key: cs[0].r } : null;
    if (n !== 5) return null;

    var ranks = {};
    cs.forEach(function (c) { ranks[c.r] = (ranks[c.r] || 0) + 1; });
    var counts = Object.keys(ranks).map(function (k) { return ranks[k]; }).sort();
    var flush = cs.every(function (c) { return c.s === cs[0].s; });
    var distinct = Object.keys(ranks).length;
    var straight = distinct === 5 && (cs[4].r - cs[0].r === 4);

    if (straight && flush) return { count: 5, cat: 4, key: cv(top) };
    if (counts[counts.length - 1] === 4) {
      var quad = Number(Object.keys(ranks).filter(function (k) { return ranks[k] === 4; })[0]);
      return { count: 5, cat: 3, key: quad };
    }
    if (counts.length === 2 && counts[0] === 2) { // full house (3+2)
      var trip = Number(Object.keys(ranks).filter(function (k) { return ranks[k] === 3; })[0]);
      return { count: 5, cat: 2, key: trip };
    }
    if (flush) return { count: 5, cat: 1, key: cv(top) };
    if (straight) return { count: 5, cat: 0, key: cv(top) };
    return null;
  }

  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.count !== b.count) return false;
    return a.cat > b.cat || (a.cat === b.cat && a.key > b.key);
  }

  function hasStartCard(cards) { return cards.some(function (c) { return c.r === 3 && c.s === 0; }); }
  function isFirstTrickEver() { return hands.reduce(function (s, h) { return s + h.length; }, 0) === 52; }

  // ── Combo generation (for AI) ──
  function combos(hand) {
    var out = [];
    var i, j, k, m, p;
    for (i = 0; i < hand.length; i++) out.push([hand[i]]); // singles
    var byRank = {};
    hand.forEach(function (c) { (byRank[c.r] = byRank[c.r] || []).push(c); });
    Object.keys(byRank).forEach(function (r) {
      var g = byRank[r];
      if (g.length >= 2) for (i = 0; i < g.length; i++) for (j = i + 1; j < g.length; j++) out.push([g[i], g[j]]);
      if (g.length >= 3) for (i = 0; i < g.length; i++) for (j = i + 1; j < g.length; j++) for (k = j + 1; k < g.length; k++) out.push([g[i], g[j], g[k]]);
    });
    // 5-card hands: enumerate 5-subsets (fine for ≤13 cards)
    var h = hand;
    for (i = 0; i < h.length; i++) for (j = i + 1; j < h.length; j++) for (k = j + 1; k < h.length; k++)
      for (m = k + 1; m < h.length; m++) for (p = m + 1; p < h.length; p++) {
        var set = [h[i], h[j], h[k], h[m], h[p]];
        if (classify(set)) out.push(set);
      }
    return out;
  }

  function render() {
    // Opponents
    var ob = $("b2-opponents"); ob.innerHTML = "";
    for (var pl = 1; pl <= 3; pl++) {
      var box = document.createElement("div");
      box.className = "b2-opp" + (current === pl ? " turn" : "");
      box.innerHTML = '<div class="b2-opp-name">AI ' + pl + (current === pl ? " ●" : "") + '</div>' +
        '<div class="b2-opp-cards">' + hands[pl].length + ' cards</div>';
      ob.appendChild(box);
    }
    // Pile
    var pe = $("b2-pile"); pe.innerHTML = "";
    if (pile) {
      pile.cards.slice().sort(function (a, b) { return cv(a) - cv(b); }).forEach(function (c) { pe.appendChild(cardEl(c, false)); });
      $("b2-pile-by").textContent = (pile.player === 0 ? "You" : "AI " + pile.player) + " played";
    } else {
      $("b2-pile-by").textContent = over ? "" : (current === 0 ? "Your lead — play anything" : "");
    }
    // Hand
    var he = $("b2-hand"); he.innerHTML = "";
    hands[0].forEach(function (c, idx) {
      var el = cardEl(c, true);
      if (selected.indexOf(idx) >= 0) el.classList.add("sel");
      el.addEventListener("click", function () {
        var at = selected.indexOf(idx);
        if (at >= 0) selected.splice(at, 1); else selected.push(idx);
        render();
      });
      he.appendChild(el);
    });
    $("b2-play").disabled = current !== 0 || over;
    $("b2-pass").disabled = current !== 0 || over || !pile; // can't pass when leading
  }

  function cardEl(c, big) {
    var el = document.createElement("div");
    el.className = "b2-card" + (red(c) ? " red" : "") + (big ? "" : " sm");
    el.innerHTML = '<span>' + label(c.r) + '</span><span>' + SUITS[c.s] + '</span>';
    return el;
  }

  function msg(t) { $("b2-msg").textContent = t; }

  function play(player, cards) {
    var combo = classify(cards);
    var h = hands[player];
    cards.forEach(function (c) { h.splice(h.indexOf(c), 1); });
    pile = { cards: cards, combo: combo, player: player };
    lastPlayer = player; passes = 0;
    if (h.length === 0) { over = true; render(); msg((player === 0 ? "You win! 🎉" : "AI " + player + " wins.") + " Press New game."); return; }
    advance();
  }

  function pass(player) {
    passes++;
    if (passes >= 3) { pile = null; passes = 0; current = lastPlayer; msg((current === 0 ? "You" : "AI " + current) + " take the trick."); render(); if (current !== 0) setTimeout(aiTurn, 700); return; }
    advance();
  }

  function advance() {
    current = (current + 1) % 4;
    render();
    if (!over && current !== 0) setTimeout(aiTurn, 700);
    else if (!over) msg(pile ? "Your turn — beat it or pass." : "Your lead.");
  }

  function aiTurn() {
    var player = current;
    var hand = hands[player];
    var cand = combos(hand).map(function (set) { return { set: set, combo: classify(set) }; });
    var choice = null;
    if (!pile) {
      // Leading: must include 3♦ on the very first trick of the game.
      var pool = isFirstTrickEver() ? cand.filter(function (x) { return hasStartCard(x.set); }) : cand;
      // play the lowest single available (simple, safe)
      pool = pool.filter(function (x) { return x.combo.count === 1; });
      pool.sort(function (a, b) { return a.combo.key - b.combo.key; });
      choice = pool[0] || null;
      if (!choice) { // fallback: lowest of anything
        cand.sort(function (a, b) { return a.combo.count - b.combo.count || a.combo.key - b.combo.key; });
        choice = cand[0];
      }
    } else {
      var beating = cand.filter(function (x) { return beats(x.combo, pile.combo); });
      beating.sort(function (a, b) { return a.combo.cat - b.combo.cat || a.combo.key - b.combo.key; });
      choice = beating[0] || null;
    }
    if (choice) play(player, choice.set); else pass(player);
  }

  // ── Human controls ──
  function selectedCards() { return selected.map(function (i) { return hands[0][i]; }); }

  $("b2-play").addEventListener("click", function () {
    if (current !== 0 || over) return;
    var cards = selectedCards();
    var combo = classify(cards);
    if (!combo) { msg("That's not a legal combination."); return; }
    if (isFirstTrickEver() && !hasStartCard(cards)) { msg("First play must include the 3♦."); return; }
    if (pile && !beats(combo, pile.combo)) { msg("That doesn't beat the pile."); return; }
    selected = [];
    play(0, cards);
  });

  $("b2-pass").addEventListener("click", function () {
    if (current !== 0 || over || !pile) return;
    selected = []; render(); pass(0);
  });

  $("b2-sort").addEventListener("click", function () { sortHand(hands[0]); selected = []; render(); });
  $("b2-new").addEventListener("click", deal);

  function deal() {
    var d = newDeck();
    hands = [[], [], [], []];
    d.forEach(function (c, i) { hands[i % 4].push(c); });
    hands.forEach(sortHand);
    pile = null; passes = 0; selected = []; over = false;
    // starter = holder of 3♦
    current = 0;
    for (var pl = 0; pl < 4; pl++) if (hands[pl].some(function (c) { return c.r === 3 && c.s === 0; })) current = pl;
    render();
    if (current === 0) msg("You hold 3♦ — you lead. It must be in your first play.");
    else { msg("AI " + current + " leads."); setTimeout(aiTurn, 700); }
  }

  deal();
})();
