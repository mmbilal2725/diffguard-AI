import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyGitHubWebhookSignature(input: {
  payload: string;
  secret: string;
  signature: string | undefined;
}): boolean {
  if (input.signature === undefined || !input.signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = `${SIGNATURE_PREFIX}${createHmac("sha256", input.secret)
    .update(input.payload)
    .digest("hex")}`;
  const actualBuffer = Buffer.from(input.signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
