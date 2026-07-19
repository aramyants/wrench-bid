export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isVerifiedCallDestination(
  phone: string | null | undefined,
  verified: boolean,
): phone is string {
  return verified && typeof phone === "string" && E164_PHONE_PATTERN.test(phone);
}
