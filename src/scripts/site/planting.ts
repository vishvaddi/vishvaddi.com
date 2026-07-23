const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DEFAULT_ZONE = "au-temperate";
const STORAGE_KEY = "vv_planting_zone";

function currentSydneyMonth(): number {
  return Number(new Intl.DateTimeFormat("en-AU", {
    month: "numeric",
    timeZone: "Australia/Sydney",
  }).format(new Date()));
}

export function initPlantingCalendar(): void {
  const zoneSelect = document.querySelector<HTMLSelectElement>("#zone-select");
  const blurb = document.querySelector<HTMLElement>(".zone-blurb");
  const heading = document.querySelector<HTMLElement>("#month-heading");
  const emptyNote = document.querySelector<HTMLElement>(".empty-note");
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".month-tab"));
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".plant-card"));
  if (!zoneSelect || !tabs.length || !cards.length) return;
  const zoneControl = zoneSelect;

  const params = new URLSearchParams(location.search);
  const availableZones = new Set(Array.from(zoneControl.options, (option) => option.value));
  const requestedZone = params.get("zone") || localStorage.getItem(STORAGE_KEY) || DEFAULT_ZONE;
  let zone = availableZones.has(requestedZone) ? requestedZone : DEFAULT_ZONE;
  const monthParam = params.get("month");
  const requestedMonth = monthParam === null ? Number.NaN : Number(monthParam);
  let month = requestedMonth >= 0 && requestedMonth <= 12 ? requestedMonth : currentSydneyMonth();

  function syncUrl(): void {
    const next = new URL(location.href);
    next.searchParams.set("zone", zone);
    next.searchParams.set("month", String(month));
    history.replaceState(null, "", next);
  }

  function render(): void {
    zoneControl.value = zone;
    const selectedOption = zoneControl.selectedOptions[0];
    if (blurb) blurb.textContent = selectedOption?.dataset.blurb || "";

    tabs.forEach((tab) => {
      const active = Number(tab.dataset.month) === month;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    let count = 0;
    cards.forEach((card) => {
      const sowingMonths = (card.dataset.sow || "").split(",").map(Number);
      const visible = card.dataset.zone === zone && (month === 0 || sowingMonths.includes(month));
      card.hidden = !visible;
      if (visible) count++;
    });

    if (heading) {
      heading.textContent = month === 0
        ? `All crops for this zone (${count})`
        : `Sow in ${MONTHS[month - 1]} - ${count} ${count === 1 ? "crop" : "crops"}`;
    }
    if (emptyNote) emptyNote.hidden = count > 0;
    localStorage.setItem(STORAGE_KEY, zone);
    syncUrl();
  }

  zoneSelect.addEventListener("change", () => {
    zone = zoneSelect.value;
    render();
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      month = Number(tab.dataset.month);
      render();
    });
  });

  render();
}
