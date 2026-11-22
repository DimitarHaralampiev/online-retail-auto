import Localize from "../../../components/localize";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import PasswordReset from "../../../components/password-reset";

export const metadata = {
  title: "Нова парола — AUTO/SHOP",
  // The token lives in the fragment; never leak the page URL onwards.
  referrer: "no-referrer" as const,
};

export default function ResetPage() {
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="site-width checkout-page">
            <PasswordReset />
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
