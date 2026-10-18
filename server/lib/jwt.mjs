/**
 * Read-only JWT helpers for broker session tokens. Nothing here verifies a signature: the broker issued the token and
 * is the only party that checks it. These helpers only read claims the app needs locally (expiry, account id) and
 * never log the token.
 */

/** The decoded payload (middle segment) of a JWT, or null when `token` is not a readable JWT. */
export function decodeJwtPayload(token) {
  const segments = String(token ?? "").split(".");
  if (segments.length !== 3 || !segments[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** The `exp` claim as epoch milliseconds, or null when absent. */
export function jwtExpiryMs(token) {
  const exp = decodeJwtPayload(token)?.exp;
  return Number.isFinite(exp) ? exp * 1000 : null;
}
