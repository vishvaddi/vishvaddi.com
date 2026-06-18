type ChannelButton = HTMLButtonElement & {
  dataset: {
    videoId: string;
    channel: string;
    title: string;
    year: string;
    genre: string;
    runtime: string;
  };
};

const EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const WATCH_ORIGIN = "https://www.youtube.com/watch";

export function initTv(): void {
  const set = document.querySelector<HTMLElement>("#tv-set");
  const screen = document.querySelector<HTMLElement>("#tv-screen");
  const player = document.querySelector<HTMLIFrameElement>("#tv-player");
  const offScreen = document.querySelector<HTMLElement>("#tv-off");
  const powerButton = document.querySelector<HTMLButtonElement>("#tv-power");
  const previousButton = document.querySelector<HTMLButtonElement>("#tv-channel-down");
  const nextButton = document.querySelector<HTMLButtonElement>("#tv-channel-up");
  const fullscreenButton = document.querySelector<HTMLButtonElement>("#tv-fullscreen");
  const channelReadout = document.querySelector<HTMLElement>("#tv-channel");
  const titleReadout = document.querySelector<HTMLElement>("#tv-title");
  const metaReadout = document.querySelector<HTMLElement>("#tv-meta");
  const youtubeLink = document.querySelector<HTMLAnchorElement>("#tv-youtube-link");
  const channels = Array.from(
    document.querySelectorAll<ChannelButton>(".tv-guide-item"),
  );

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
    !youtubeLink ||
    channels.length === 0
  ) {
    return;
  }

  let powered = false;
  let selectedIndex = 0;

  try {
    const savedId = localStorage.getItem("crt-tv-channel");
    const savedIndex = channels.findIndex(
      (channel) => channel.dataset.videoId === savedId,
    );
    if (savedIndex >= 0) selectedIndex = savedIndex;
  } catch {
    // Local storage can be unavailable in privacy-restricted contexts.
  }

  const selectedChannel = (): ChannelButton => channels[selectedIndex];

  const embedUrl = (videoId: string): string => {
    const params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      playsinline: "1",
      color: "white",
    });
    return `${EMBED_ORIGIN}/embed/${videoId}?${params.toString()}`;
  };

  const renderChannel = (loadVideo = powered): void => {
    const channel = selectedChannel();
    const { videoId, title, year, runtime } = channel.dataset;

    channels.forEach((button, index) => {
      const active = index === selectedIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    channelReadout.textContent = `CH ${channel.dataset.channel}`;
    titleReadout.textContent = title.toUpperCase();
    metaReadout.textContent = `${year} · ${runtime.toUpperCase()}`;
    youtubeLink.href = `${WATCH_ORIGIN}?v=${videoId}`;
    player.title = `${title} on CRT TV`;

    if (loadVideo) {
      player.src = embedUrl(videoId);
    }

    try {
      localStorage.setItem("crt-tv-channel", videoId);
    } catch {
      // Selection persistence is optional.
    }
  };

  const setPower = (nextPowered: boolean): void => {
    powered = nextPowered;
    set.classList.toggle("is-on", powered);
    powerButton.setAttribute("aria-pressed", String(powered));
    powerButton.classList.toggle("active", powered);
    offScreen.hidden = powered;
    player.hidden = !powered;

    if (powered) {
      renderChannel(true);
    } else {
      player.src = "about:blank";
    }
  };

  const changeChannel = (direction: number): void => {
    selectedIndex =
      (selectedIndex + direction + channels.length) % channels.length;
    renderChannel();
  };

  powerButton.addEventListener("click", () => setPower(!powered));
  previousButton.addEventListener("click", () => changeChannel(-1));
  nextButton.addEventListener("click", () => changeChannel(1));

  channels.forEach((channel, index) => {
    channel.addEventListener("click", () => {
      selectedIndex = index;
      if (!powered) {
        setPower(true);
      } else {
        renderChannel(true);
      }
      set.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await screen.requestFullscreen();
      }
    } catch {
      youtubeLink.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.matches(
        "input, textarea, select, button, a, [contenteditable='true']",
      )
    ) {
      return;
    }

    if (event.key.toLowerCase() === "p") {
      setPower(!powered);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      changeChannel(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      changeChannel(-1);
    } else if (event.key.toLowerCase() === "f") {
      fullscreenButton.click();
    }
  });

  renderChannel(false);
}
