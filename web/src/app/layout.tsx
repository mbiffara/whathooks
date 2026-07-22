import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const title = t("title");
  const description = t("description");
  return {
    // www is the canonical host (the apex 308s to it).
    metadataBase: new URL("https://www.whathooks.app"),
    title,
    description,
    // "./" resolves per-route, so every page canonicalizes to its own URL.
    alternates: { canonical: "./" },
    openGraph: {
      title,
      description,
      url: "./",
      siteName: "whathooks",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  // Explicit theme choice (cookie) renders server-side so there's no flash;
  // without it the OS preference applies via CSS alone.
  const themeCookie = (await cookies()).get("THEME")?.value;
  const theme =
    themeCookie === "light" || themeCookie === "dark" ? themeCookie : undefined;
  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
