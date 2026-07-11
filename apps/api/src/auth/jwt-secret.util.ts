import { randomBytes } from "crypto";

let cached: string | undefined;

/**
 * Resolve the JWT signing secret (auth-session-hardening).
 *
 * - Uses `JWT_SECRET` when set.
 * - In production, throws if it is unset/empty — the API must NOT fall back to a
 *   hardcoded default (would let anyone forge tokens).
 * - In dev/test, generates a single ephemeral secret per process (logged once) so
 *   all sign/verify sites agree; tokens invalidate on restart.
 *
 * Memoized so every call site (JwtModule factory, JwtStrategy, AuthService) gets
 * the SAME value within a process.
 */
export function getJwtSecret(): string {
  if (cached) return cached;

  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET must be set in production — refusing to start with an insecure default secret.",
    );
  }

  cached = randomBytes(32).toString("hex");
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] JWT_SECRET not set — using an ephemeral dev secret. Sessions invalidate on restart; set JWT_SECRET for stable sessions.",
  );
  return cached;
}
