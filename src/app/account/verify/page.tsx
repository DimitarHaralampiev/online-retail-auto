import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import EmailVerification from "../../../components/email-verification";
export const metadata = {
  title: "Потвърждение на имейл",
  referrer: "no-referrer" as const,
};
export default function VerifyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <EmailVerification />
      </main>
      <SiteFooter />
    </>
  );
}
