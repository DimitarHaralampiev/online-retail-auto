import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import OrderTracking from "../../../components/order-tracking";
export const metadata = {
  title: "Проследяване на поръчка",
  referrer: "no-referrer" as const,
};
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <OrderTracking id={id} />
      </main>
      <SiteFooter />
    </>
  );
}
