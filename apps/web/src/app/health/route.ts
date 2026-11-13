import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Instant liveness probe for Next.js web client.
 * Returns HTTP 200 immediately without external network or database calls.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "@nuts/web",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
