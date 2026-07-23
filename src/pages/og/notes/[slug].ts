import { OGImageRoute } from "astro-og-canvas";
import { getCollection } from "astro:content";

const notes = await getCollection("notes", ({ data }) => !data.draft);

const pages = Object.fromEntries(
  notes.map((note) => [
    note.id,
    {
      title: note.data.title,
      description: note.data.description ?? "",
    },
  ]),
);

const route = await OGImageRoute({
  pages,
  getImageOptions: (_path: string, page: { title: string; description: string }) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[250, 250, 247]] as [number, number, number][],
    border: { color: [26, 26, 26] as [number, number, number], width: 4, side: "block-start" as const },
    padding: 80,
    font: {
      title: {
        size: 72,
        families: ["Iowan Old Style", "Garamond", "Times New Roman", "serif"],
        weight: "Normal" as const,
        color: [26, 26, 26] as [number, number, number],
      },
      description: {
        size: 32,
        families: ["Iowan Old Style", "Garamond", "Times New Roman", "serif"],
        weight: "Normal" as const,
        color: [80, 80, 80] as [number, number, number],
        lineHeight: 1.4,
      },
    },
  }),
});

export const getStaticPaths = route.getStaticPaths;
export const GET = route.GET;
