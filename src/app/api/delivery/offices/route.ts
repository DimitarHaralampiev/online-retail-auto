import { NextResponse } from "next/server";
import { courierOffices, officeMode } from "../../../../lib/courier-offices";
export async function GET(request: Request) {
  const courier = new URL(request.url).searchParams.get("courier");
  if (courier !== "econt" && courier !== "speedy")
    return NextResponse.json(
      { error: "Избери валиден куриер." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { offices: await courierOffices(courier), mode: officeMode() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error && !e.message.startsWith("[")
            ? e.message
            : "Неуспешно зареждане на офисите. Опитай отново или избери адрес.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
