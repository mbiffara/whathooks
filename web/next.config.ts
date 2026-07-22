import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // This app is the workspace root; avoids picking up an unrelated parent lockfile.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default withNextIntl(nextConfig);
