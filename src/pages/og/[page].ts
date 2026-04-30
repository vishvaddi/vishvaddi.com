import { OGImageRoute } from "astro-og-canvas";

const pages = {
  index: { title: "Vish Vaddi", description: "Estimator. Sydney." },
  work: { title: "Work", description: "Retail and commercial fit-out estimating. Sydney." },
  about: { title: "About", description: "Vish Vaddi — about." },
  now: { title: "Now", description: "What I'm focused on right now." },
  notes: { title: "Notes", description: "Ideas I keep coming back to." },
  blog: { title: "Blog", description: "Longer writing." },
  music: { title: "Music", description: "What I'm listening to and producing." },
  movies: { title: "Movies", description: "Films I keep coming back to." },
  books: { title: "Books", description: "What I've been reading." },
  prepping: { title: "Prepping", description: "Bushcraft, survival, and self-sufficiency." },
};

const route = await OGImageRoute({
  param: "page",
  pages,
  getImageOptions: (_path: string, page: { title: string; description: string }) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[250, 250, 247]] as [number, number, number][],
    border: { color: [26, 26, 26] as [number, number, number], width: 4, side: "block-start" as const },
    padding: 80,
    font: {
      title: {
        size: 96,
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
