// El CRM como app en el móvil («Añadir a pantalla de inicio»): se abre sin la barra del navegador
export function GET() {
  return Response.json(
    {
      name: "The Heure Society CRM",
      short_name: "THS CRM",
      description: "CRM de The Heure Society",
      start_url: "/admin",
      scope: "/admin",
      display: "standalone",
      background_color: "#0b100d",
      theme_color: "#0f1a14",
      lang: "es",
      icons: [
        { src: "/admin-app/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/admin-app/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/admin-app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
