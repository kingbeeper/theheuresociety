import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Fuentes y logo de los PDF de documentos (se leen del disco en el servidor)
  outputFileTracingIncludes: {
    "/d/\\[token\\]/pdf": ["src/lib/pdf-assets/**/*"],
    "/api/telegram": ["src/lib/pdf-assets/**/*"],
  },
  partialPrefetching: true,
  // Fotos subidas por el robot de Telegram (Supabase Storage)
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
