import type { Metadata } from "next";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import "../globals.css";

// Plantilla raíz del CRM (independiente de la web pública, solo en español y sin indexar)
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["300", "400"], style: ["normal", "italic"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["300", "400"] });

export const metadata: Metadata = {
  title: { default: "CRM — The Heure Society", template: "%s · CRM The Heure Society" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${cormorant.variable} ${montserrat.variable} antialiased`}>
      <body className="min-h-screen bg-ink">{children}</body>
    </html>
  );
}
