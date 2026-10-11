import { currentCustomer } from "../../../lib/accounts";
import {
  getCustomerFeatures,
  mutateCustomerFeatures,
} from "../../../lib/customer-features";
import { requestJson, json, orderError } from "../../../lib/order-http";
export async function GET() {
  try {
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в потвърден профил." }, 401);
    return json(await getCustomerFeatures(customer.id));
  } catch {
    return json({ error: "Данните на профила временно не са достъпни." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    const value = await requestJson(request);
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в потвърден профил." }, 401);
    return json(await mutateCustomerFeatures(customer.id, value));
  } catch (e) {
    return orderError(e);
  }
}
