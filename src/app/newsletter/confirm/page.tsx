import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import NewsletterLink from "../../../components/newsletter-link";

export const metadata = {
  title: "Абонамент — AUTO/SHOP",
  // The token lives in the fragment; never leak the page URL onwards.
  referrer: "no-referrer" as const,
};

export default function NewsletterPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <NewsletterLink action="confirm" />
      </main>
      <SiteFooter />
    </>
  );
}
