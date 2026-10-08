import type { NextConfig } from "next";

const config: NextConfig = {
  // Le serveur de développement a son propre dossier : il ne corrompt plus un build de production voisin.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@mon-agent-ia/core", "@mon-agent-ia/config", "@mon-agent-ia/db", "@mon-agent-ia/ai"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "@prisma/client", "unpdf", "fflate"],
  experimental: { optimizePackageImports: ["lucide-react", "framer-motion"] },
  async headers() {
    // La CSP (avec nonce) est posée dans le middleware ; ici les en-têtes statiques.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
