import type { CheckoutConflict } from "../vite-env";

export function isCheckoutConflict(
  res: unknown,
): res is CheckoutConflict {
  return Boolean(
    res &&
      typeof res === "object" &&
      (res as { conflict?: string }).conflict === "checkout-open",
  );
}
