import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated app surfaces — nothing indexable behind them.
      disallow: ["/dashboard", "/admin", "/reset-password", "/invite"],
    },
    sitemap: "https://www.whathooks.app/sitemap.xml",
  };
}
