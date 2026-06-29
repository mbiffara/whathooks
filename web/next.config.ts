import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // This app is the workspace root; avoids picking up an unrelated parent lockfile.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
