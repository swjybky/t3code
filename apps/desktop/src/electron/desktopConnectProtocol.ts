import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";

export function desktopSchemeForConnectKey(
  isDevelopment: boolean,
  publishableKey: string | undefined,
): string {
  if (!isDevelopment) return "t3code";
  const key = publishableKey?.trim();
  if (key?.startsWith("pk_live_")) {
    try {
      // The official Clerk instance allows t3code://app but rejects t3code-dev://app.
      if (clerkFrontendApiHostnameFromPublishableKey(key) === "clerk.t3.codes") {
        return "t3code";
      }
    } catch {
      // An unreadable key keeps the development origin.
    }
  }
  return "t3code-dev";
}
