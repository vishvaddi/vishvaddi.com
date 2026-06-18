// Planting calendar data. Built from general horticultural facts (botanical
// names and broadly-established sowing windows per climate) plus original
// growing notes — not copied from any single source. A crop's botanical info is
// defined once in META; each zone carries only its own sowing months (1=Jan …
// 12=Dec). Windows are guidance for the zone's typical microclimate.

export type Category =
  | "Fruiting"
  | "Leafy"
  | "Root"
  | "Legume"
  | "Brassica"
  | "Allium"
  | "Herb";

interface Meta {
  name: string;
  sci: string;
  cat: Category;
  harvest: string;
  tip: string;
}

export interface ZonePlant extends Meta {
  sow: number[];
}

export interface Zone {
  id: string;
  name: string;
  blurb: string;
  plants: ZonePlant[];
}

const META: Record<string, Meta> = {
  tomato: { name: "Tomato", sci: "Solanum lycopersicum", cat: "Fruiting", harvest: "10–14 weeks",
    tip: "Plant deep, stake at planting and water the soil — not the leaves — to dodge fungal disease in the humidity." },
  capsicum: { name: "Capsicum", sci: "Capsicum annuum", cat: "Fruiting", harvest: "12–16 weeks",
    tip: "Slow to start in the cool — bottom heat helps germination. Pinch the first flower for a stronger plant." },
  chilli: { name: "Chilli", sci: "Capsicum spp.", cat: "Fruiting", harvest: "14–18 weeks",
    tip: "Loves heat and a long season. Hold back water and feeding as fruit ripens to sharpen the heat." },
  eggplant: { name: "Eggplant", sci: "Solanum melongena", cat: "Fruiting", harvest: "12–16 weeks",
    tip: "Warm soil is everything. Net young plants against fruit fly and harvest while the skin is still glossy." },
  cucumber: { name: "Cucumber", sci: "Cucumis sativus", cat: "Fruiting", harvest: "8–10 weeks",
    tip: "Trellis to keep fruit off wet ground. Pick often and small — one overgrown cucumber stalls the whole vine." },
  zucchini: { name: "Zucchini", sci: "Cucurbita pepo", cat: "Fruiting", harvest: "6–8 weeks",
    tip: "Hand-pollinate on humid mornings if fruit rots at the tip. Harvest at 15–20 cm; they bloat fast." },
  pumpkin: { name: "Pumpkin", sci: "Cucurbita maxima", cat: "Fruiting", harvest: "15–20 weeks",
    tip: "Give it room to ramble. Leave fruit on the vine until the stem corks, then cure in the sun a fortnight." },
  corn: { name: "Sweet corn", sci: "Zea mays", cat: "Fruiting", harvest: "11–14 weeks",
    tip: "Sow in a block, not a row, so wind can pollinate it — sparse blocks give gappy cobs." },
  bean: { name: "Climbing bean", sci: "Phaseolus vulgaris", cat: "Legume", harvest: "9–11 weeks",
    tip: "Sow straight into warm soil; seedlings sulk when transplanted. Pick daily to keep them cropping." },
  snowpea: { name: "Snow pea", sci: "Pisum sativum", cat: "Legume", harvest: "10–12 weeks",
    tip: "A cool-season crop — sow when nights turn cold. Give them something to climb early." },
  lettuce: { name: "Lettuce", sci: "Lactuca sativa", cat: "Leafy", harvest: "8–10 weeks",
    tip: "Bolts in heat — pick outer leaves to keep one plant going for weeks, and sow a few at a time." },
  rocket: { name: "Rocket", sci: "Eruca vesicaria", cat: "Leafy", harvest: "5–7 weeks",
    tip: "Fast and forgiving. Sow a short row every fortnight; flavour turns hot and bitter once it bolts." },
  silverbeet: { name: "Silverbeet", sci: "Beta vulgaris var. cicla", cat: "Leafy", harvest: "8–12 weeks",
    tip: "The workhorse. Harvest outer stalks and it keeps throwing new growth for months." },
  kale: { name: "Kale", sci: "Brassica oleracea (Acephala)", cat: "Brassica", harvest: "8–10 weeks",
    tip: "Sweeter after a cool night. Net early or squash cabbage-white caterpillars — they find it fast." },
  broccoli: { name: "Broccoli", sci: "Brassica oleracea (Italica)", cat: "Brassica", harvest: "10–16 weeks",
    tip: "Cut the main head with stalk and side shoots keep coming for weeks." },
  cabbage: { name: "Cabbage", sci: "Brassica oleracea (Capitata)", cat: "Brassica", harvest: "11–15 weeks",
    tip: "Feed steadily for tight hearts. Net against cabbage moth from day one." },
  carrot: { name: "Carrot", sci: "Daucus carota", cat: "Root", harvest: "12–16 weeks",
    tip: "Sow direct into fine, stone-free soil — never transplant. Keep the surface damp until the slow seed strikes." },
  beetroot: { name: "Beetroot", sci: "Beta vulgaris", cat: "Root", harvest: "9–12 weeks",
    tip: "Each 'seed' is a cluster, so thin to one seedling. The thinnings are good eating as baby leaves." },
  radish: { name: "Radish", sci: "Raphanus sativus", cat: "Root", harvest: "4–6 weeks",
    tip: "The quick win — ready in a month. Pull promptly before they turn woody and hot." },
  sweetpotato: { name: "Sweet potato", sci: "Ipomoea batatas", cat: "Root", harvest: "16–20 weeks",
    tip: "Plant rooted slips, not seed. Thrives in warmth; lift before the first cool snap dulls the tubers." },
  springonion: { name: "Spring onion", sci: "Allium fistulosum", cat: "Allium", harvest: "8–10 weeks",
    tip: "Snip what you need and leave the roots — many varieties simply regrow." },
  garlic: { name: "Garlic", sci: "Allium sativum", cat: "Allium", harvest: "20–28 weeks",
    tip: "Plant single cloves at the cool turn of autumn, pointy end up. Stop watering once the tops yellow." },
  basil: { name: "Basil", sci: "Ocimum basilicum", cat: "Herb", harvest: "6–8 weeks",
    tip: "A warm-season herb — pinch the tips often and remove flower spikes to keep the leaves sweet." },
  coriander: { name: "Coriander", sci: "Coriandrum sativum", cat: "Herb", harvest: "6–8 weeks for leaf",
    tip: "Bolts the moment it's warm — grow it through the cooler months and sow a little, often." },
  parsley: { name: "Parsley", sci: "Petroselinum crispum", cat: "Herb", harvest: "10–12 weeks",
    tip: "Slow to germinate — soak the seed overnight first. A biennial, so it crops for the best part of a year." },
  // zone specialties
  okra: { name: "Okra", sci: "Abelmoschus esculentus", cat: "Fruiting", harvest: "9–11 weeks",
    tip: "Loves heat. Pick the pods young at 8–10 cm or they turn stringy; wear sleeves, the plants can irritate skin." },
  snakebean: { name: "Snake bean", sci: "Vigna unguiculata ssp. sesquipedalis", cat: "Legume", harvest: "10–12 weeks",
    tip: "A vigorous warm-climate climber — pick the long pods before the beans swell for the best texture." },
  ginger: { name: "Ginger", sci: "Zingiber officinale", cat: "Root", harvest: "8–10 months",
    tip: "Plant plump rhizome pieces with a visible bud in warm, rich soil; harvest once the leaves die back." },
  taro: { name: "Taro", sci: "Colocasia esculenta", cat: "Root", harvest: "6–8 months",
    tip: "Wants wet feet — grow in damp, rich ground. Always cook the corms and leaves; raw they're an irritant." },
  rosella: { name: "Rosella", sci: "Hibiscus sabdariffa", cat: "Fruiting", harvest: "5–6 months",
    tip: "Grown for its tangy calyces — pick them young and tender just after the petals drop, for jam and cordial." },
  broadbean: { name: "Broad bean", sci: "Vicia faba", cat: "Legume", harvest: "15–20 weeks",
    tip: "A cool-season legume — sow into cold soil. Pinch the tips once flowering to deter aphids and speed the pods." },
  parsnip: { name: "Parsnip", sci: "Pastinaca sativa", cat: "Root", harvest: "16–20 weeks",
    tip: "Slow and stubborn to germinate — use fresh seed and keep moist. A frost sweetens the roots." },
  leek: { name: "Leek", sci: "Allium ampeloprasum", cat: "Allium", harvest: "20–25 weeks",
    tip: "Plant deep in a dibbed hole and don't backfill — the long blanched white shaft is the prize." },
  brussels: { name: "Brussels sprouts", sci: "Brassica oleracea (Gemmifera)", cat: "Brassica", harvest: "16–20 weeks",
    tip: "A long, cold crop — they need real cold to firm up. Pick from the bottom of the stalk upward." },
  potato: { name: "Potato", sci: "Solanum tuberosum", cat: "Root", harvest: "15–20 weeks",
    tip: "Plant certified seed potatoes, not supermarket ones, and mound soil over the stems as they grow to swell the tubers." },
  watermelon: { name: "Watermelon", sci: "Citrullus lanatus", cat: "Fruiting", harvest: "12–16 weeks",
    tip: "Needs heat, room and steady water until the fruit sets — then ease off to concentrate the sugars." },
  rockmelon: { name: "Rockmelon", sci: "Cucumis melo", cat: "Fruiting", harvest: "12–16 weeks",
    tip: "Thrives in dry heat. Ripe when the fruit slips cleanly from the stem and smells sweet at the base." },
  pakchoy: { name: "Pak choy", sci: "Brassica rapa (Chinensis)", cat: "Brassica", harvest: "6–8 weeks",
    tip: "A fast Asian green, ready in weeks. Sow in the cool so it doesn't bolt straight to flower." },
};

// Sowing months per zone, keyed by the META id above.
const SOW: Record<string, Record<string, number[]>> = {
  "au-cool": {
    tomato: [9, 10, 11], capsicum: [9, 10], chilli: [9, 10], eggplant: [9, 10],
    cucumber: [10, 11, 12], zucchini: [10, 11, 12], pumpkin: [10, 11], corn: [10, 11, 12],
    bean: [10, 11, 12], snowpea: [8, 9, 2, 3], lettuce: [8, 9, 10, 11, 12, 1, 2, 3],
    rocket: [8, 9, 10, 2, 3, 4], silverbeet: [8, 9, 10, 11, 12, 1, 2, 3], kale: [1, 2, 3, 9, 10],
    broccoli: [1, 2, 9, 10], cabbage: [1, 2, 9, 10], carrot: [8, 9, 10, 11, 12, 1, 2],
    beetroot: [9, 10, 11, 12, 1, 2], radish: [8, 9, 10, 11, 12, 1, 2, 3], sweetpotato: [11, 12],
    springonion: [8, 9, 10, 11, 12, 1, 2, 3], garlic: [3, 4, 5], basil: [11, 12, 1],
    coriander: [9, 10, 11, 2, 3], parsley: [8, 9, 10, 11, 12, 1, 2, 3],
    broadbean: [3, 4, 5], parsnip: [8, 9, 10], leek: [8, 9, 10, 11], brussels: [10, 11, 12], potato: [9, 10, 11],
  },
  "au-temperate": {
    tomato: [8, 9, 10, 11], capsicum: [8, 9, 10], chilli: [8, 9, 10], eggplant: [8, 9, 10],
    cucumber: [9, 10, 11, 12, 1], zucchini: [9, 10, 11, 12, 1], pumpkin: [9, 10, 11, 12],
    corn: [9, 10, 11, 12, 1], bean: [9, 10, 11, 12, 1, 2], snowpea: [3, 4, 5, 6, 7],
    lettuce: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12], rocket: [2, 3, 4, 5, 8, 9, 10],
    silverbeet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], kale: [1, 2, 3, 4, 9, 10],
    broccoli: [1, 2, 3, 4, 9], cabbage: [1, 2, 3, 4, 9, 10], carrot: [8, 9, 10, 11, 12, 1, 2, 3, 4],
    beetroot: [8, 9, 10, 11, 12, 1, 2, 3], radish: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12],
    sweetpotato: [10, 11, 12], springonion: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    garlic: [3, 4, 5], basil: [10, 11, 12, 1, 2], coriander: [2, 3, 4, 5, 8, 9],
    parsley: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    broadbean: [3, 4, 5], potato: [8, 9, 2, 3], leek: [9, 10, 11, 12], pakchoy: [2, 3, 4, 8, 9],
  },
  "au-subtropical": {
    tomato: [7, 8, 9, 2, 3], capsicum: [8, 9, 10, 1], chilli: [8, 9, 10, 1], eggplant: [8, 9, 10, 1],
    cucumber: [8, 9, 10, 11, 2, 3], zucchini: [8, 9, 10, 2, 3], pumpkin: [8, 9, 10, 11],
    corn: [8, 9, 10, 11, 12, 1, 2], bean: [8, 9, 10, 11, 2, 3, 4], snowpea: [3, 4, 5, 6, 7],
    lettuce: [2, 3, 4, 5, 6, 7, 8, 9], rocket: [3, 4, 5, 6, 7, 8, 9],
    silverbeet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], kale: [2, 3, 4, 5, 6, 7, 8],
    broccoli: [2, 3, 4, 5], cabbage: [2, 3, 4, 5, 6], carrot: [2, 3, 4, 5, 6, 7, 8, 9],
    beetroot: [2, 3, 4, 5, 6, 7, 8, 9], radish: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    sweetpotato: [9, 10, 11, 12, 1], springonion: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    garlic: [3, 4, 5], basil: [9, 10, 11, 12, 1, 2, 3], coriander: [3, 4, 5, 6, 7, 8],
    parsley: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    okra: [9, 10, 11, 12, 1], ginger: [9, 10], snakebean: [9, 10, 11, 12, 1], pakchoy: [2, 3, 4, 5, 8, 9],
  },
  "au-tropical": {
    tomato: [4, 5, 6, 7], capsicum: [4, 5, 6, 7], chilli: [3, 4, 5, 6, 7, 8], eggplant: [4, 5, 6, 7, 8],
    cucumber: [3, 4, 5, 6, 7, 8], zucchini: [4, 5, 6, 7], pumpkin: [3, 4, 5, 6],
    corn: [3, 4, 5, 6, 7, 8], bean: [3, 4, 5, 6, 7, 8], snowpea: [5, 6, 7],
    lettuce: [4, 5, 6, 7, 8], rocket: [4, 5, 6, 7, 8], silverbeet: [3, 4, 5, 6, 7, 8],
    kale: [4, 5, 6, 7], broccoli: [4, 5, 6], cabbage: [4, 5, 6], carrot: [4, 5, 6, 7, 8],
    beetroot: [4, 5, 6, 7], radish: [3, 4, 5, 6, 7, 8], sweetpotato: [9, 10, 11, 12, 1, 2],
    springonion: [3, 4, 5, 6, 7, 8], basil: [3, 4, 5, 6, 7, 8, 9], coriander: [5, 6, 7],
    parsley: [4, 5, 6, 7, 8],
    okra: [3, 4, 5, 6, 7, 8, 9, 10], snakebean: [3, 4, 5, 6, 7, 8, 9], ginger: [9, 10, 11], taro: [10, 11, 12, 1], rosella: [9, 10, 11], pakchoy: [4, 5, 6, 7, 8],
  },
  "au-arid": {
    tomato: [8, 9, 2, 3], capsicum: [8, 9], chilli: [8, 9], eggplant: [8, 9],
    cucumber: [8, 9, 2, 3], zucchini: [8, 9, 2, 3], pumpkin: [8, 9], corn: [8, 9, 1, 2],
    bean: [8, 9, 2, 3], snowpea: [3, 4, 5, 8], lettuce: [3, 4, 5, 8, 9], rocket: [3, 4, 5, 8, 9],
    silverbeet: [3, 4, 8, 9, 10], kale: [2, 3, 4, 8, 9], broccoli: [2, 3, 8, 9], cabbage: [2, 3, 8, 9],
    carrot: [3, 4, 8, 9], beetroot: [3, 4, 8, 9], radish: [3, 4, 5, 8, 9, 10], sweetpotato: [9, 10],
    springonion: [3, 4, 8, 9], garlic: [3, 4, 5], basil: [9, 10, 11, 2, 3], coriander: [3, 4, 5, 8],
    parsley: [3, 4, 8, 9, 10],
    watermelon: [8, 9], rockmelon: [8, 9], okra: [9, 10], pakchoy: [3, 4, 8, 9],
  },
};

const ZONE_INFO = [
  { id: "au-cool", name: "Australia — Cool / Mountain",
    blurb: "Cold, frosty winters and short, mild summers (e.g. Tasmania, the alps, highland Victoria). Tender crops go out only after the last frost; cool crops thrive spring and autumn." },
  { id: "au-temperate", name: "Australia — Temperate",
    blurb: "Four distinct seasons with cool winters and warm summers (e.g. Sydney, Melbourne, Adelaide, Perth). Warm crops in spring, cool crops through autumn and late winter." },
  { id: "au-subtropical", name: "Australia — Sub-tropical",
    blurb: "Warm, humid summers and mild, dry winters (e.g. SE Queensland, northern NSW). Warm-season crops from late winter; cool-season crops through autumn." },
  { id: "au-tropical", name: "Australia — Tropical",
    blurb: "Hot all year with a wet and a dry season (e.g. Darwin, Cairns). The cooler, drier months are the main vegetable season; the wet suits heat-lovers and root crops." },
  { id: "au-arid", name: "Australia — Arid",
    blurb: "Hot, dry summers, cold nights and big temperature swings (e.g. Alice Springs, the outback). Sow in the gentler shoulders of spring and autumn, and shade from the worst heat." },
];

export const ZONES: Zone[] = ZONE_INFO.map((z) => ({
  id: z.id,
  name: z.name,
  blurb: z.blurb,
  plants: Object.entries(SOW[z.id])
    .map(([id, sow]) => ({ ...META[id], sow }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}));

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
