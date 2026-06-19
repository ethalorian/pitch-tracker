import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes PitchCall installable to the iPad home screen
 * and launch full-screen (no Safari chrome). Navy/amber to match the app
 * so the splash + status chrome feel native.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PitchCall",
    short_name: "PitchCall",
    description: "Live pitch-calling tracker for fastpitch softball",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#131c30",
    theme_color: "#10172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
