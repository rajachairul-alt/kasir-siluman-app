import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Dev-only convenience so the demo doesn't need a separate onboarding flow:
// makes sure the demo merchant used by the /session page actually exists.
// A real merchant sign-up flow is out of scope for the MVP (see BOB_BRIEF.md).

const DEMO_MERCHANT_ID = "demo-merchant";

export async function POST() {
  const merchant = await db.merchant.upsert({
    where: { id: DEMO_MERCHANT_ID },
    update: {},
    create: {
      id: DEMO_MERCHANT_ID,
      name: "Bakso Pak Budi",
      cartType: "gerobak",
    },
  });

  return NextResponse.json(merchant);
}
