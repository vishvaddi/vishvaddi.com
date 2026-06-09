// Big 2 (Big Two): single player vs three local AI opponents.
(function () {
  var SUITS = ["♦", "♣", "♥", "♠"];
  var RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" };
  var AI_NAMES = ["", "Auntie", "Uncle", "Cousin"];
  var $ = function (id) { return document.getElementById(id); };
  if (!$("b2-hand")) return;

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

  function label(rank) { return RANK_LABEL[rank] || String(rank); }
  function cardName(card) { return label(card.r) + SUITS[card.s]; }
  function cardValue(card) { return card.r * 4 + card.s; }
  function isRed(card) { return card.s === 0 || card.s === 2; }
  function playerName(player) { return player === 0 ? "You" : AI_NAMES[player]; }

  function newDeck() {
    var deck = [];
    var rank;
    var suit;
    for (rank = 3; rank <= 15; rank++) {
      for (suit = 0; suit < 4; suit++) deck.push({ r: rank, s: suit });
    }
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
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

  function chooseLead(candidates) {
    var pool = candidates.slice();
    if (isFirstTrick()) pool = pool.filter(function (candidate) { return hasStartCard(candidate.set); });
    pool.sort(function (a, b) {
      return b.combo.count - a.combo.count ||
        a.combo.cat - b.combo.cat ||
        a.combo.key - b.combo.key;
    });
    return pool[0] || null;
  }

  function chooseResponse(candidates, player) {
    var beating = candidates.filter(function (candidate) { return beats(candidate.combo, pile.combo); });
    beating.sort(function (a, b) {
      return a.combo.cat - b.combo.cat || a.combo.key - b.combo.key;
    });
    if (!beating.length) return null;

    // Uncle presses harder near the finish; Cousin is intentionally less predictable.
    if (player === 2 && hands[player].length <= 5) return beating[beating.length - 1];
    if (player === 3 && beating.length > 1 && Math.random() < 0.3) {
      return beating[Math.floor(Math.random() * Math.min(3, beating.length))];
    }
    return beating[0];
  }

  function selectionState() {
    var cards = selectedCards();
    var combo = classify(cards);
    if (!cards.length) return { valid: false, text: hands[0].length + " cards remaining" };
    if (!combo) return { valid: false, text: "Not a legal combination" };
    if (isFirstTrick() && !hasStartCard(cards)) {
      return { valid: false, text: combo.name + " · must include 3♦" };
    }
    if (pile && !beats(combo, pile.combo)) {
      return { valid: false, text: combo.name + " · does not beat " + pile.combo.name.toLowerCase() };
    }
    return { valid: true, text: combo.name + " · ready to play" };
  }

  function render() {
    $("b2-round").textContent = "Round " + round;
    $("b2-record").textContent = stats.wins + " wins · " + stats.losses + " losses";
    $("b2-turn").textContent = over ? "Round finished" : playerName(current);
    $("b2-target").textContent = pile
      ? pile.combo.name + " · " + pile.cards.map(cardName).join(" ")
      : "Open lead";

    var opponents = $("b2-opponents");
    opponents.textContent = "";
    for (var player = 1; player <= 3; player++) {
      var box = document.createElement("div");
      box.className = "b2-opp" + (current === player ? " turn" : "");
      var name = document.createElement("div");
      name.className = "b2-opp-name";
      name.textContent = AI_NAMES[player] + (current === player ? " · playing" : "");
      var cards = document.createElement("div");
      cards.className = "b2-opp-cards";
      cards.textContent = hands[player].length + " cards";
      var backs = document.createElement("div");
      backs.className = "b2-card-backs";
      for (var back = 0; back < Math.min(hands[player].length, 10); back++) {
        var backCard = document.createElement("span");
        backCard.className = "b2-card-back";
        backs.appendChild(backCard);
      }
      box.append(name, cards, backs);
      opponents.appendChild(box);
    }

    var pileElement = $("b2-pile");
    pileElement.textContent = "";
    if (pile) {
      pile.cards.slice().sort(function (a, b) { return cardValue(a) - cardValue(b); }).forEach(function (card) {
        pileElement.appendChild(cardElement(card, false));
      });
      $("b2-pile-by").textContent = playerName(pile.player) + " played " + pile.combo.name.toLowerCase();
    } else {
      $("b2-pile-by").textContent = over ? "" : playerName(current) + " lead";
    }

    var playableCards = new Set();
    if (current === 0 && !over) {
      legalPlays(hands[0]).forEach(function (candidate) {
        candidate.set.forEach(function (card) { playableCards.add(card); });
      });
    }

    var handElement = $("b2-hand");
    handElement.textContent = "";
    hands[0].forEach(function (card, index) {
      var element = cardElement(card, true);
      if (selected.indexOf(index) >= 0) element.classList.add("sel");
      if (playableCards.has(card)) element.classList.add("playable");
      element.setAttribute("aria-pressed", selected.indexOf(index) >= 0 ? "true" : "false");
      element.addEventListener("click", function () {
        if (current !== 0 || over) return;
        var at = selected.indexOf(index);
        if (at >= 0) selected.splice(at, 1);
        else selected.push(index);
        render();
      });
      handElement.appendChild(element);
    });

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

  function renderQuickMoves() {
    var target = $("b2-quick");
    target.textContent = "";
    if (over) {
      var finished = document.createElement("span");
      finished.className = "b2-quick-empty";
      finished.textContent = "Start a new deal to play again.";
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

  function finish(player) {
    over = true;
    clearAITimer();
    if (player === 0) stats.wins++;
    else stats.losses++;
    saveStats();
    render();
    message(player === 0
      ? "You win with " + hands.slice(1).reduce(function (total, hand) { return total + hand.length; }, 0) + " opponent cards left."
      : AI_NAMES[player] + " wins. You had " + hands[0].length + " cards left.");
  }

  function play(player, cards) {
    var combo = classify(cards);
    var hand = hands[player];
    cards.forEach(function (card) { hand.splice(hand.indexOf(card), 1); });
    pile = { cards: cards, combo: combo, player: player };
    lastPlayer = player;
    passes = 0;
    if (!hand.length) {
      finish(player);
      return;
    }
    advance();
  }

  function pass(player) {
    passes++;
    if (passes >= 3) {
      pile = null;
      passes = 0;
      current = lastPlayer;
      selected = [];
      message(playerName(current) + " take the trick and lead again.");
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
    var candidates = candidatePlays(hands[player]);
    var choice = pile ? chooseResponse(candidates, player) : chooseLead(candidates);
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
    var choice = pile ? chooseResponse(options, 1) : chooseLead(options);
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
  $("b2-new").addEventListener("click", deal);

  document.addEventListener("keydown", function (event) {
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "Enter") playSelection();
    else if (event.key.toLowerCase() === "p" && !$("b2-pass").disabled) $("b2-pass").click();
    else if (event.key.toLowerCase() === "h") showHint();
    else if (event.key.toLowerCase() === "s") $("b2-sort").click();
    else if (event.key.toLowerCase() === "n") deal();
  });

  deal();
})();
