import type { Metadata } from "next";
import "./globals.css";
import PwaRegister from "@/components/pwa-register";
import CookieConsent from "@/components/cookie-consent";

export const metadata: Metadata = {
  metadataBase: new URL("https://pcfbattle.be"),
  title: "Powerchair Floorball Battle — The Ultimate Test of Your Skills",
  description: "Powerchair Floorball Battle brings teams together for high-level international powerchair floorball competition in an exciting arena atmosphere.",
  openGraph: {
    type: "website",
    url: "https://pcfbattle.be/",
    siteName: "PCF BATTLE",
    images: [{ url: "/pcf-social-graph.jpg", width: 2048, height: 1075, alt: "Powerchair Floorball Battle" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/pcf-social-graph.jpg"],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon-32.png",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  applicationName: "PCF BATTLE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192" />
        <link rel="shortcut icon" href="/favicon-32.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const saved = localStorage.getItem("pcf-theme");
                const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
                document.documentElement.dataset.theme = dark ? "dark" : "light";
              } catch {}
            })();`,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <PwaRegister />
        <CookieConsent />
      </body>
    </html>
  );
}
