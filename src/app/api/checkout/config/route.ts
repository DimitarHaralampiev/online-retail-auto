import { storeOrderConfig } from "../../../../lib/store-settings";
import { json } from "../../../../lib/order-http";
export async function GET() {
  try {
    return json(await storeOrderConfig());
  } catch {
    return json(
      { error: "Настройките за доставка временно не са достъпни." },
      503,
    );
  }
}
