import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/.well-known/harbinger", destination: "/api/harbinger" },
      { source: "/.well-known/x403.json", destination: "/api/x403" },
      { source: "/v1/stream", destination: "/api/v1/stream" },
      { source: "/v1/index", destination: "/api/v1/index" },
      { source: "/v1/watches", destination: "/api/v1/watches" },
      { source: "/v1/hooks", destination: "/api/v1/hooks" },
      { source: "/v1/agency", destination: "/api/v1/agency" },
      { source: "/v1/patrol", destination: "/api/v1/patrol" },
      { source: "/v1/tape", destination: "/api/v1/tape" },
      { source: "/v1/rails/agentmail", destination: "/api/v1/agentmail" },
    ];
  },
};

export default nextConfig;
