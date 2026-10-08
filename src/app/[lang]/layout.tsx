import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import { hasLocale, locales } from "@/lib/i18n";
import { getDictionary } from "./dictionaries";
import { JsonLd, SITE_NAME, SITE_URL, storeJsonLd } from "@/lib/seo";
import "../globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  // Solo los grosores que se usan: menos fuentes que descargar
  weight: ["300", "400"],
  style: ["normal", "italic"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400"],
});

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  // Valores por defecto: cada página define su título, su URL canónica y sus idiomas
  return {
    metadataBase: new URL(SITE_URL),
    title: dict.meta.title,
    description: dict.meta.description,
    applicationName: SITE_NAME,
  };
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      className={`${cormorant.variable} ${montserrat.variable} antialiased`}
    >
      <body className="min-h-screen">
        <JsonLd data={storeJsonLd(lang)} />
        {children}
      </body>
    </html>
  );
}
