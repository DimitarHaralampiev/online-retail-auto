import { currentCustomer } from "../../../lib/accounts";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import BusinessChat from "../../../components/business-chat";
import Link from "next/link";
import { requestLocale } from "../../../lib/i18n/server";
export default async function InsightsPage() {
  const admin = await currentCustomer();
  const en = (await requestLocale()) === "en";
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width insights-page">
        {admin?.isAdmin ? (
          <BusinessChat />
        ) : (
          <p>
            <Link href="/account">
              {en
                ? "Sign in with an administrator account."
                : "Влез с администраторски профил."}
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
