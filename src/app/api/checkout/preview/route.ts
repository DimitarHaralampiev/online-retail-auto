import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { previewCheckout } from "../../../../lib/checkout";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { error: "Изпрати данните като JSON." },
      { status: 415, headers },
    );
  const reader = request.body?.getReader();
  if (!reader)
    return NextResponse.json(
      { error: "Липсват данни." },
      { status: 400, headers },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Заявката е твърде голяма." },
          { status: 413, headers },
        );
      }
      chunks.push(value);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return NextResponse.json(
        { error: "Невалидни данни." },
        { status: 400, headers },
      );
    }
    try {
      return NextResponse.json(previewCheckout(input), { headers });
    } catch (error) {
      if (error instanceof ZodError)
        return NextResponse.json(
          { error: error.issues[0]?.message ?? "Провери данните." },
          { status: 400, headers },
        );
      if (error instanceof Error)
        return NextResponse.json(
          { error: error.message },
          { status: 400, headers },
        );
      return NextResponse.json(
        { error: "Неуспешна проверка." },
        { status: 400, headers },
      );
    }
  } finally {
    reader.releaseLock();
  }
}
