import { User } from "../generated/prisma";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";

const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
const encoder = new TextEncoder();

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${hash.toString("hex")}:${salt.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [hashHex, saltHex] = stored.split(":");
  const hash = Buffer.from(hashHex, "hex");
  const salt = Buffer.from(saltHex, "hex");
  const test = scryptSync(password, salt, 64);
  return timingSafeEqual(hash, test);
}

export async function signUserJWT(user: Pick<User, "id" | "email" | "name">) {
  return await new SignJWT({ sub: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encoder.encode(SECRET));
}

export async function verifyJWT(token: string) {
  const { payload } = await jwtVerify(token, encoder.encode(SECRET));
  return payload as {
    sub: string;
    email: string;
    name: string;
    iat: number;
    exp: number;
  };
}
