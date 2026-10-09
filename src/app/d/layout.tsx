import type { Metadata } from "next";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import "../globals.css";

// Documentos para el cliente (cotización, memo, factura): página privada por enlace, imprimible
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["300", "400"], style: ["normal", "italic"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["300", "400"] });

export const metadata: Metadata = {
  title: "The Heure Society",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${montserrat.variable} antialiased`}>
      <body className="doc min-h-screen">
        {/* Papel claro (la web es oscura) y márgenes de impresión */}
        <style>{`html body.doc{background:#e9e6df;color:#1b1f1c}@media print{html body.doc{background:#fff}@page{margin:14mm}}`}</style>
        {children}
      </body>
    </html>
  );
}
