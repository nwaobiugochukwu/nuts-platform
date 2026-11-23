import { headers } from "next/headers";
import Script from "next/script";

export async function PaystackScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <Script
      src="https://js.paystack.co/v2/inline.js"
      strategy="lazyOnload"
      nonce={nonce}
    />
  );
}
