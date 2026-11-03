import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt parameters (node:crypto defaults are the OWASP-recommended floor).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const FORMAT = "scrypt";

/** scrypt hash with an individual random salt, in a self-describing format. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return [FORMAT, N, R, P, salt.toString("hex"), hash.toString("hex")].join(
    "$",
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(password, salt, KEYLEN, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}
