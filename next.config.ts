import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Keep the existing contributor guide under manual control.
  agentRules: false,
  // Security headers for every response (the CSP is set per request in
  // src/proxy.ts). Not advertising the framework version.
  poweredByHeader: false,
  // Container images (Dockerfile) run the self-contained server; local and
  // CI builds keep `next start`.
  ...(process.env.NEXT_OUTPUT === "standalone" && {
    output: "standalone" as const,
  }),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
};

export default nextConfig;
