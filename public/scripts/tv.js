(function () {
  var BASE_CHANNELS = [
    {
      number: "01",
      name: "CINEMA ONE",
      schedule: {
        morning: {
          title: "His Girl Friday",
          year: "1940",
          runtime: "1h 32m",
          provider: "archive",
          id: "HisGirlFriday1940",
          label: "Classic newsroom screwball",
        },
        afternoon: {
          title: "My Favorite Brunette",
          year: "1947",
          runtime: "1h 29m",
          provider: "archive",
          id: "BBOMyFavoriteBrunette1947",
          label: "Fast-paced detective comedy",
        },
        night: {
          title: "The Stranger",
          year: "1946",
          runtime: "1h 35m",
          provider: "archive",
          id: "silent-the-stranger",
          label: "Moody post-war noir",
        },
      },
    },
    {
      number: "02",
      name: "CULT / MIDNIGHT",
      schedule: {
        morning: {
          title: "House on Haunted Hill",
          year: "1959",
          runtime: "1h 15m",
          provider: "archive",
          id: "House_On_Haunted_Hill.avi",
          label: "Old dark house shocker",
        },
        afternoon: {
          title: "Carnival of Souls",
          year: "1962",
          runtime: "1h 24m",
          provider: "archive",
          id: "carnival-of-souls-1962_202108",
          label: "Acclaimed indie horror · ★7.0",
        },
        night: {
          title: "The Last Man on Earth",
          year: "1964",
          runtime: "1h 26m",
          provider: "archive",
          id: "the-last-man-on-earth-1964_202312",
          label: "Vincent Price apocalypse · ★6.8",
        },
      },
    },
    {
      number: "03",
      name: "ADVENTURE",
      schedule: {
        morning: {
          title: "20,000 Leagues Under the Sea",
          year: "1954",
          runtime: "1h 43m",
          provider: "youtube",
          id: "SsHMYIDdpPI",
          label: "Disney sea adventure",
        },
        afternoon: {
          title: "Gulliver's Travels",
          year: "1939",
          runtime: "1h 17m",
          provider: "archive",
          id: "GulliversTravels720p_652",
          label: "Animated classic",
        },
        night: {
          title: "The Lost World",
          year: "1925",
          runtime: "1h 17m",
          provider: "archive",
          id: "TheLostWorld_207",
          label: "Silent era spectacle",
        },
      },
    },
    {
      number: "04",
      name: "ART / STRANGE",
      schedule: {
        morning: {
          title: "Sita Sings the Blues",
          year: "2008",
          runtime: "1h 22m",
          provider: "archive",
          id: "Sita_Sings_the_Blues_1080p_dirac_vorbis.ogg",
          label: "Animated cult feature",
        },
        afternoon: {
          title: "Caligari / Mabuse",
          year: "1920 / 1933",
          runtime: "2h 10m",
          provider: "archive",
          id: "the-cabinet-of-dr.-caligari-the-testament-of-dr.-mabuse",
          label: "German expressionist double bill",
        },
        night: {
          title: "Detour",
          year: "1945",
          runtime: "1h 7m",
          provider: "archive",
          id: "detour_202110",
          label: "Edgar Ulmer noir classic · ★7.2",
        },
      },
    },
    {
      number: "05",
      name: "LATE FEATURES",
      schedule: {
        morning: {
          title: "Charade",
          year: "1963",
          runtime: "1h 53m",
          provider: "archive",
          id: "charade_202604",
          label: "Grant & Hepburn romp · ★7.9",
        },
        afternoon: {
          title: "McLintock!",
          year: "1963",
          runtime: "2h 7m",
          provider: "archive",
          id: "mclintok_widescreen",
          label: "Roughhouse western comedy",
        },
        night: {
          title: "The Phantom of the Opera",
          year: "1925",
          runtime: "1h 33m",
          provider: "archive",
          id: "silent-the-phantom-of-the-opera",
          label: "Silent horror classic",
        },
      },
    },
    // CH 06-07: full films verified live on YouTube as embeddable
    // (playableInEmbed:true) and rating > 6. Recent licensed films won't embed,
    // so the modern end caps at 80s cult (Night of the Comet, 1984).
    {
      number: "06",
      name: "NIGHT TERRORS",
      schedule: {
        morning: {
          title: "Night of the Comet",
          year: "1984",
          runtime: "1h 35m",
          provider: "youtube",
          id: "OEXzslm0ru8",
          label: "80s cult sci-fi · ★6.3",
        },
        afternoon: {
          title: "Night of the Living Dead",
          year: "1968",
          runtime: "1h 36m",
          provider: "youtube",
          id: "J7Yvhe5fKmM",
          label: "Romero zombie landmark · ★7.8",
        },
        night: {
          title: "Nosferatu",
          year: "1922",
          runtime: "1h 25m",
          provider: "youtube",
          id: "_elGFZrJN6w",
          label: "Expressionist vampire classic · ★7.9",
        },
      },
    },
    {
      number: "07",
      name: "NOIR ALLEY",
      schedule: {
        morning: {
          title: "D.O.A.",
          year: "1949",
          runtime: "1h 23m",
          provider: "youtube",
          id: "BhbPMf7Jz10",
          label: "Poisoned-man noir · ★7.2",
        },
        afternoon: {
          title: "The Hitch-Hiker",
          year: "1953",
          runtime: "1h 11m",
          provider: "youtube",
          id: "XIeFKTbg3Aw",
          label: "Ida Lupino road noir · ★7.0",
        },
        night: {
          title: "Scarlet Street",
          year: "1945",
          runtime: "1h 42m",
          provider: "youtube",
          id: "glsKgwu5YHM",
          label: "Fritz Lang noir · ★7.8",
        },
      },
    },
    {
      number: "08",
      name: "NEW RELEASES",
      schedule: {
        morning: {
          title: "Rendel: Dark Vengeance",
          year: "2017",
          runtime: "1h 45m",
          provider: "youtube",
          id: "ra0vF8YSvps",
          label: "Finnish vigilante action, free with ads",
        },
        afternoon: {
          title: "Banger",
          year: "2018",
          runtime: "1h 23m",
          provider: "youtube",
          id: "ds_VNsWnqxs",
          label: "Crime thriller, free with ads",
        },
        night: {
          title: "Lair",
          year: "2021",
          runtime: "1h 30m",
          provider: "youtube",
          id: "_9uzCpsANQs",
          label: "Possession horror, free with ads",
        },
      },
    },
    {
      number: "09",
      name: "FREE FEATURES",
      schedule: {
        morning: {
          title: "A Birder's Guide to Everything",
          year: "2013",
          runtime: "1h 26m",
          provider: "youtube",
          id: "bopJV_Xk_Ls",
          label: "Coming-of-age comedy with Ben Kingsley",
        },
        afternoon: {
          title: "Halo 4: Forward Unto Dawn",
          year: "2012",
          runtime: "1h 31m",
          provider: "youtube",
          id: "eXPFCTYqCag",
          label: "Sci-fi war feature",
        },
        night: {
          title: "eXistenZ",
          year: "1999",
          runtime: "1h 37m",
          provider: "youtube",
          id: "36C74wcr9JI",
          label: "Cronenberg's game-world thriller",
        },
      },
    },
    {
      number: "10",
      name: "NINETIES",
      schedule: {
        morning: {
          title: "The Canterville Ghost",
          year: "1996",
          runtime: "1h 32m",
          provider: "youtube",
          id: "oWMJSl_ARSA",
          label: "Patrick Stewart haunts a manor",
        },
        afternoon: {
          title: "Call of the Wild",
          year: "1994",
          runtime: "1h 37m",
          provider: "youtube",
          id: "qDd3Wuliw3E",
          label: "Jack London adventure",
        },
        night: {
          title: "Fever",
          year: "1999",
          runtime: "1h 29m",
          provider: "youtube",
          id: "NG4UEfI2qes",
          label: "Dark mystery with Teri Hatcher",
        },
      },
    },
    {
      number: "11",
      name: "DOCS",
      schedule: {
        morning: {
          title: "Meet the Patels",
          year: "2014",
          runtime: "1h 28m",
          provider: "youtube",
          id: "QofdbUNmczo",
          label: "Warm family documentary",
        },
        afternoon: {
          title: "Nothing to Hide",
          year: "2017",
          runtime: "1h 26m",
          provider: "archive",
          id: "nothingtohidefilm",
          label: "Surveillance and you, CC BY-NC",
        },
        night: {
          title: "TPB AFK",
          year: "2013",
          runtime: "1h 22m",
          provider: "archive",
          id: "TpbAfkThePirateBayAwayFromKeyboard",
          label: "The Pirate Bay trial, CC BY-NC",
        },
      },
    },
    {
      number: "12",
      name: "OPEN MOVIES",
      schedule: {
        morning: {
          title: "Sintel",
          year: "2010",
          runtime: "15m",
          provider: "archive",
          id: "Sintel",
          label: "Blender open movie, CC BY",
        },
        afternoon: {
          title: "Tears of Steel",
          year: "2012",
          runtime: "12m",
          provider: "archive",
          id: "Tears-of-Steel",
          label: "Blender live-action VFX short, CC BY",
        },
        night: {
          title: "Cosmos Laundromat",
          year: "2015",
          runtime: "12m",
          provider: "archive",
          id: "CosmosLaundromatFirstCycle",
          label: "Blender open movie, CC BY",
        },
      },
    },
    {
      number: "13",
      name: "INDIE / CC",
      schedule: {
        morning: {
          title: "Sita Sings the Blues",
          year: "2008",
          runtime: "1h 22m",
          provider: "archive",
          id: "Sita_Sings_the_Blues",
          label: "Nina Paley's animated Ramayana, public domain",
        },
        afternoon: {
          title: "Star Wreck: In the Pirkinning",
          year: "2005",
          runtime: "1h 43m",
          provider: "archive",
          id: "StarWreckInThePirkining",
          label: "Finnish fan-made space parody, CC BY-SA",
        },
        night: {
          title: "Route 66: An American (bad) Dream",
          year: "2006",
          runtime: "1h 28m",
          provider: "archive",
          id: "Route_66_-_an_American_badDream",
          label: "Road documentary, CC BY-NC",
        },
      },
    },
  ];
  var CHANNELS = BASE_CHANNELS.slice();

  var set = document.querySelector("#tv-set");
  var screen = document.querySelector("#tv-screen");
  var player = document.querySelector("#tv-player");
  var offScreen = document.querySelector("#tv-off");
  var powerButton = document.querySelector("#tv-power");
  var previousButton = document.querySelector("#tv-channel-down");
  var nextButton = document.querySelector("#tv-channel-up");
  var fullscreenButton = document.querySelector("#tv-fullscreen");
  var channelReadout = document.querySelector("#tv-channel");
  var titleReadout = document.querySelector("#tv-title");
  var metaReadout = document.querySelector("#tv-meta");
  var guide = document.querySelector("#tv-guide-list");
  var segmentLabel = document.querySelector("#tv-segment-label");

  if (
    !set ||
    !screen ||
    !player ||
    !offScreen ||
    !powerButton ||
    !previousButton ||
    !nextButton ||
    !fullscreenButton ||
    !channelReadout ||
    !titleReadout ||
    !metaReadout ||
    !guide ||
    !segmentLabel
  ) {
    return;
  }

  var state = {
    powered: false,
    selectedIndex: 0,
    segment: getSegment(),
  };

  function getSegment(date) {
    var hour = (date || new Date()).getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 18) return "afternoon";
    return "night";
  }

  function segmentLabelText(segment) {
    if (segment === "morning") return "MORNING";
    if (segment === "afternoon") return "AFTERNOON";
    return "NIGHT";
  }

  function selectedChannel() {
    return CHANNELS[state.selectedIndex];
  }

  function currentProgram(channel) {
    return channel.schedule[state.segment] || channel.schedule.morning;
  }

  function shuffleArray(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function embedUrl(program) {
    if (program.provider === "youtube") {
      return "https://www.youtube-nocookie.com/embed/" + program.id + "?autoplay=1&rel=0&playsinline=1&modestbranding=1";
    }
    return "https://archive.org/embed/" + program.id;
  }

  function setGuideActive() {
    var items = Array.prototype.slice.call(guide.querySelectorAll(".tv-guide-item"));
    items.forEach(function (button, index) {
      var active = index === state.selectedIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderGuide() {
    guide.textContent = "";
    var fragment = document.createDocumentFragment();

    CHANNELS.forEach(function (channel, index) {
      var button = document.createElement("button");
      button.className = "tv-guide-item";
      button.type = "button";
      button.setAttribute("aria-pressed", String(index === state.selectedIndex));

      var program = currentProgram(channel);
      var firstLine = program.title + " (" + program.year + ")";
      var secondLine = program.label + " · " + program.runtime;

      var channelLabel = document.createElement("span");
      channelLabel.className = "tv-guide-channel";
      channelLabel.textContent = "CH " + channel.number;
      button.appendChild(channelLabel);

      var copy = document.createElement("span");
      copy.className = "tv-guide-copy";
      var strong = document.createElement("strong");
      strong.textContent = channel.name;
      var small = document.createElement("small");
      small.textContent = firstLine + " · " + secondLine;
      copy.appendChild(strong);
      copy.appendChild(small);
      button.appendChild(copy);

      var play = document.createElement("span");
      play.className = "tv-guide-play";
      play.textContent = "WATCH";
      button.appendChild(play);

      button.addEventListener("click", function () {
        state.selectedIndex = index;
        if (!state.powered) setPower(true);
        else renderSelection(true);
      });

      fragment.appendChild(button);
    });

    guide.appendChild(fragment);
    setGuideActive();
  }

  function shuffleChannels() {
    var selected = selectedChannel();
    CHANNELS = shuffleArray(BASE_CHANNELS);
    state.selectedIndex = Math.max(0, CHANNELS.findIndex(function (channel) {
      return channel.name === selected.name;
    }));
    renderGuide();
    if (state.powered) renderSelection(true);
  }

  function renderSelection(loadVideo) {
    if (loadVideo === void 0) loadVideo = state.powered;
    var channel = selectedChannel();
    var program = currentProgram(channel);
    setGuideActive();
    channelReadout.textContent = "CH " + channel.number;

    titleReadout.textContent = program.title.toUpperCase();
    metaReadout.textContent = program.year + " · " + program.runtime;
    player.title = program.title + " on CRT TV";
    if (loadVideo) {
      player.removeAttribute("srcdoc");
      player.src = embedUrl(program);
      player.hidden = false;
      offScreen.hidden = true;
    }
  }

  function setPower(nextPowered) {
    state.powered = nextPowered;
    set.classList.toggle("is-on", state.powered);
    powerButton.setAttribute("aria-pressed", String(state.powered));
    powerButton.classList.toggle("active", state.powered);

    if (state.powered) {
      renderSelection(true);
    } else {
      player.src = "about:blank";
      player.removeAttribute("srcdoc");
      player.hidden = true;
      offScreen.hidden = false;
      offScreen.innerHTML = "<span class=\"tv-off-dot\" aria-hidden=\"true\"></span><strong>STANDBY</strong><span>PRESS POWER</span>";
    }
  }

  function moveChannel(direction) {
    state.selectedIndex =
      (state.selectedIndex + direction + CHANNELS.length) % CHANNELS.length;
    if (!state.powered) {
      setPower(true);
    } else {
      renderSelection(true);
    }
    set.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  powerButton.addEventListener("click", function () {
    setPower(!state.powered);
  });
  previousButton.addEventListener("click", function () {
    moveChannel(-1);
  });
  nextButton.addEventListener("click", function () {
    moveChannel(1);
  });
  fullscreenButton.addEventListener("click", async function () {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await screen.requestFullscreen();
      }
    } catch (error) {
      /* ignore */
    }
  });

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    if (
      target &&
      target.matches &&
      target.matches("input, textarea, select, button, a, [contenteditable='true']")
    ) {
      return;
    }

    if (event.key.toLowerCase() === "p") {
      setPower(!state.powered);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveChannel(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveChannel(-1);
    } else if (event.key.toLowerCase() === "f") {
      fullscreenButton.click();
    }
  });

  renderGuide();
})();
