import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;
const FORMAT = "scrypt-v1";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${FORMAT}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [format, saltValue, hashValue, extra] = encoded.split("$");
  if (format !== FORMAT || !saltValue || !hashValue || extra) return false;

  try {
    const salt = Buffer.from(saltValue, "base64");
    const expected = Buffer.from(hashValue, "base64");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, KEY_LENGTH) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
