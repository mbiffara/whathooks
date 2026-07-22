import Script from "next/script";

const GA_ID = "G-NH3QZYK8MK";

/**
 * Queue a GA4 event from client code. Pushes the same `arguments`-object
 * shape gtag() uses, straight onto the dataLayer — safe to call before the
 * gtag script has loaded (GA drains the buffer when it initializes).
 */
export function gaEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  w.dataLayer = w.dataLayer ?? [];
  // Same shim the inline snippet defines — whichever runs first wins, both
  // push gtag-style `arguments` objects onto the shared dataLayer.
  w.gtag =
    w.gtag ??
    function () {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  w.gtag("event", name, params ?? {});
}

/**
 * Google Analytics (GA4). Included on public pages only — never in the
 * logged-in dashboard or admin — matching the privacy policy's
 * "Advertising and cookies" section.
 */
export function GoogleAnalytics() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
