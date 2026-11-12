import type { MetadataRoute } from "next";

/** Lets visitors put twizou on their home screen. Names and colours stay plain on purpose. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "twizou",
    short_name: "twizou",
    description: "X動画を新着・24時間・週間ランキングで紹介",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#080a0d",
    theme_color: "#080a0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
