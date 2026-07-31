import { API_URL } from "@/lib/client-api";
import { NextIntlClientProvider } from "next-intl";
import { ConnectClient } from "./connect-client";

const LOCALES = ["en", "es"];

/**
 * Server shell: resolves the ACCOUNT's language (org owner's locale, from the
 * public share endpoint) so the page renders in the inviting business's
 * language rather than the visitor's browser language.
 */
export default async function ConnectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let locale = "en";
  try {
    const res = await fetch(
      `${API_URL}/public/connect/${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const view = (await res.json()) as { locale?: string };
      if (view.locale && LOCALES.includes(view.locale)) locale = view.locale;
    }
  } catch {
    /* API unreachable — fall back to English; the client shows its own error */
  }
  const messages = (await import(`../../../../messages/${locale}.json`))
    .default as { connect: Record<string, string> };
  return (
    <NextIntlClientProvider locale={locale} messages={{ connect: messages.connect }}>
      <ConnectClient token={token} />
    </NextIntlClientProvider>
  );
}
