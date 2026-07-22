import Script from "next/script";

const GA_ID = "G-NH3QZYK8MK";

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
