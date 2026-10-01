// Team logos bundled from src/assets/logos (96×96 PNGs from ESPN), named after the team, e.g. kansas-city-chiefs.png
const logos = import.meta.glob<string>("./assets/logos/*.png", { eager: true, import: "default" });

export function teamLogo(teamName: string): string | undefined {
  const slug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return logos[`./assets/logos/${slug}.png`];
}
