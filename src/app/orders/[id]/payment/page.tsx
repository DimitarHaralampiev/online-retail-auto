import Localize from "../../../../components/localize";
import SiteHeader from "../../../../components/site-header";
import SiteFooter from "../../../../components/site-footer";
import TestPayment from "../../../../components/test-payment";
export const metadata = {
  title: "Тестово плащане",
  referrer: "no-referrer" as const,
};
export default async function TestPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="site-width checkout-page">
            <TestPayment id={id} />
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
