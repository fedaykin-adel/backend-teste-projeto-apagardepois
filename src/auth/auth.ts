// src/auth/auth.ts
import type { User } from "@prisma/client";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
const encoder = new TextEncoder();

function loadJose() {
  // memoiza o import dinâmico
  return import("jose") as Promise<typeof import("jose")>;
}

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
  const { SignJWT } = await loadJose();
  return await new SignJWT({ sub: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encoder.encode(SECRET));
}

export async function verifyJWT(token: string) {
  const { jwtVerify } = await loadJose();
  const { payload } = await jwtVerify(token, encoder.encode(SECRET));
  return payload as {
    sub: string;
    email: string;
    name: string;
    iat: number;
    exp: number;
  };
}
