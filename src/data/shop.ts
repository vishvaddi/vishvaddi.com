export type ShopItem = {
  name: string;
  why: string;
  query: string;
};

export type ShopCollection = {
  id: string;
  title: string;
  intro: string;
  items: ShopItem[];
};

export const shopCollections: ShopCollection[] = [
  {
    id: "first-aid",
    title: "First aid and emergency",
    intro: "The kit that matters before gear talk starts.",
    items: [
      { name: "Snake bite compression bandage", why: "Australian snakebite response depends on pressure immobilisation.", query: "snake bite compression bandage australia" },
      { name: "Compact first aid kit", why: "A real baseline for car, work bag and home.", query: "compact first aid kit australia" },
      { name: "Israeli bandage / trauma dressing", why: "Fast direct pressure for serious bleeding.", query: "trauma dressing israeli bandage" },
      { name: "Nitrile gloves", why: "Cheap hygiene layer for every kit.", query: "nitrile gloves first aid" },
      { name: "Emergency blanket", why: "Hypothermia control, shade, signalling and shelter backup.", query: "emergency blanket survival" },
    ],
  },
  {
    id: "go-bags",
    title: "Go bags",
    intro: "Practical loadouts for get-home, evacuation and longer disruption scenarios.",
    items: [
      { name: "Trail runners or walking shoes", why: "The most common get-home failure is bad footwear.", query: "trail running shoes men" },
      { name: "35-45 L hiking pack", why: "Enough for 72 hours without becoming a burden.", query: "40l hiking backpack" },
      { name: "65 L framed pack", why: "Only for long-duration loads where capability beats speed.", query: "65l hiking backpack frame" },
      { name: "Packable rain shell", why: "Weather protection you will actually carry.", query: "packable rain jacket" },
      { name: "Merino base layer", why: "Warmth, odour control and comfort across conditions.", query: "merino base layer men" },
    ],
  },
  {
    id: "water-food-power",
    title: "Water, food and power",
    intro: "The three utilities that fail quietly until they are urgent.",
    items: [
      { name: "Single-wall stainless bottle", why: "Can carry water and boil it directly.", query: "single wall stainless steel water bottle" },
      { name: "Squeeze water filter", why: "Fast field filtration with low weight.", query: "sawyer squeeze water filter" },
      { name: "Water purification tablets", why: "Tiny backup when filters fail or clog.", query: "water purification tablets" },
      { name: "USB power bank", why: "Phone, maps, light and radio need electrons.", query: "10000mah power bank" },
      { name: "Foldable solar panel", why: "Useful for outages longer than one battery cycle.", query: "foldable solar panel usb" },
    ],
  },
  {
    id: "field-tools",
    title: "Field tools",
    intro: "Tools selected for usefulness, not gear theatre.",
    items: [
      { name: "Fixed-blade knife", why: "Cutting is the hardest core function to improvise.", query: "morakniv companion fixed blade knife" },
      { name: "Ferro rod", why: "Works wet and lasts far longer than matches.", query: "ferro rod fire starter" },
      { name: "3 x 3 m tarp", why: "The most versatile shelter per gram.", query: "3x3 ripstop tarp" },
      { name: "550 paracord", why: "Shelter, repairs, tying, lashing and field improvisation.", query: "550 paracord 30m" },
      { name: "Baseplate compass", why: "Navigation that does not depend on battery or signal.", query: "baseplate compass" },
      { name: "Headtorch", why: "Hands-free light is more useful than a handheld torch.", query: "rechargeable headtorch" },
    ],
  },
  {
    id: "home-resilience",
    title: "Home resilience",
    intro: "Small domestic buffers that prevent a minor outage becoming a bad day.",
    items: [
      { name: "Battery radio", why: "Information when mobile data and power are patchy.", query: "battery emergency radio" },
      { name: "Rechargeable AA / AAA kit", why: "Keeps torches, radios and small devices useful.", query: "rechargeable AA AAA batteries charger" },
      { name: "Fire extinguisher", why: "The home emergency you can stop in the first minute.", query: "fire extinguisher home australia" },
      { name: "Water storage jerry can", why: "A simple reserve beats last-minute panic buying.", query: "water storage jerry can" },
      { name: "Document fire safe", why: "Protects IDs, cash, drives and irreplaceable papers.", query: "fireproof document safe" },
    ],
  },
];
