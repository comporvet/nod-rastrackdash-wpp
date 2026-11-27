import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "../styles/globals.css";
import "../styles/layout-system.css";
import "../styles/crm.css";
import { getBrandConfig } from "../lib/brand";

const presentationModeBootstrap = `
  try {
    document.documentElement.dataset.presentationMode =
      window.localStorage.getItem("wpptrack-presentation-mode") === "true"
        ? "active"
        : "inactive";
  } catch {
    document.documentElement.dataset.presentationMode = "inactive";
  }
`;

// Applies the saved theme before paint (dark is the default).
const themeBootstrap = `
  try {
    document.documentElement.dataset.theme =
      window.localStorage.getItem("rastrackdash-theme") === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
`;

export function generateMetadata(): Metadata {
  const brand = getBrandConfig();

  return {
    title: brand.name,
    description: `${brand.name} - cockpit de WhatsApp, tráfego e conversões para clientes finais.`,
    icons: {
      icon: brand.faviconUrl ?? "/favicon.svg",
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const brand = getBrandConfig();
  const brandStyle = {
    "--brand-primary": brand.primaryColor,
  } as CSSProperties;

  return (
    <html lang="pt-BR" suppressHydrationWarning style={brandStyle}>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: presentationModeBootstrap }}
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
