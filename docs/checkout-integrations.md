# Checkout and delivery integration

## Current development flow

Products have illustrative EUR prices in integer cents. The cart persists only SKU and quantity in browser storage; recipient information is not persisted there. `/cart` supports quantity changes and removal. `/checkout` supports Speedy or Econt, office or address delivery, and cash on delivery or card selection.

Office fixtures are **fictional**, limited to Sofia, Plovdiv and Varna. Their `DEMO-` identifiers must never be sent to a live courier API. Selecting a different courier, city, or delivery type clears the office. Address delivery accepts Bulgarian towns and four-digit postal codes.

`POST /api/checkout/preview` is read-only. It validates contact details, the delivery branch, office/courier/city consistency, quantities, and available stock. Subtotals are recalculated from the catalog. Client prices or totals are rejected. Shipping and the final payable total remain `null` until a real shipping quote exists. A preview does not reserve stock, create an order or label, or initiate payment. Responses are not cached; request bodies are limited to 16 KiB and are not logged by application code.

## Courier adapters to implement

- **Speedy:** server-side office/location lookup, address validation, service availability, calculation, shipment creation, and tracking. Authentication stays on the server. Use the merchant's agreed services and prices. [Official API documentation](https://api.speedy.bg/api/docs/)
- **Econt:** nomenclature services for cities and offices, address validation, and shipment calculation/label creation. Office codes and addresses must be validated against current data. [Nomenclatures](https://ee.econt.com/services/Nomenclatures/), [Shipments](https://ee.econt.com/services/Shipments/)
- Fetch or cache current office data with freshness metadata; exclude lockers and unsupported services unless explicitly enabled. Never silently replace a live API failure with fictional offices.
- Build shipment input from authoritative product weights, dimensions, recipient details and configured sender information. Recalculate delivery when the cart, destination, courier, or payment method changes.
- Show the final delivery cost and payable total before confirmation. Include COD or payment fees according to the selected merchant agreements.

## Payments and real order persistence

Choose a card provider with the merchant before activating payments. Prefer a provider-hosted payment page; the application must not collect or store card numbers. Stripe Checkout is one possible adapter, not an activated or selected commercial service. [Hosted Checkout documentation](https://docs.stripe.com/payments/checkout/quickstarts)

Before accepting real orders:

1. Store validated orders, immutable price snapshots, delivery quotes and stock reservations in PostgreSQL using atomic transactions and idempotency keys.
2. Create a payment session for an existing pending order using server-calculated amounts. Verify signed webhooks; a browser redirect alone cannot mark an order paid.
3. Handle payment expiry, failures and cancellations by releasing reservations exactly once. Reconcile delayed payment events with the order's state.
4. For COD, keep payment pending until collection is confirmed through the agreed courier reconciliation process.
5. Create labels idempotently after the appropriate order confirmation step. Track fulfilment and payment as separate states; support returns/refunds explicitly.

Hosting remains undecided. These boundaries can be implemented with self-hosted PostgreSQL or a managed service. No courier credentials or payment keys are needed for the demo.

## Storefront reference and scope

Reviewed [Avtozona](https://avtozona.net/) as a reference for visible search, direct category navigation, product purchase controls and delivery/payment information. Adapted these general shopping patterns to the existing graphite/orange identity and a small starting catalog: three non-empty category links, a shared search form, clear demo prices, cart controls and a short checkout. No competitor assets, branding, product descriptions, promotions or customer reviews are used.
