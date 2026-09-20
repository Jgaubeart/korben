import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Korben",
    short_name: "Korben",
    description: "Your calm AI operating system.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#f3efe6",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
