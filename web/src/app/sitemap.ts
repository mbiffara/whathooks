import type { MetadataRoute } from "next";

const BASE = "https://www.whathooks.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/teams`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/signup`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/signin`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.1 },
  ];
}
