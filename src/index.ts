// src/server/express-app.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ingestPayload, traceBackendRoute } from "@shaayud/sdk-node";
import dotenv from 'dotenv'
import { prisma } from "./db/prisma";
import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient()
export type Product = PrismaClient["product"]["$types"]["Default"]
import {
  hashPassword,
  signUserJWT,
  verifyJWT,
  verifyPassword,
} from "./auth/auth";
dotenv.config()
const app = express();

const COOKIE_NAME = "auth";
const COOKIE_OPTS = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: false, // true em prod/https
};

// middlewares
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// anexa meta de backend para o ingest (evita circular nas próprias rotas de ingest)
app.use(traceBackendRoute(["/identity/ingest"]));

// pretty JSON em dev
if (process.env.NODE_ENV !== "production") {
  app.use((_req, res, next) => {
    const old = res.json.bind(res);
    res.json = (body: any) => old(body);
    next();
  });
}

// ------ INGEST ------
app.post("/identity/ingest", async (req: Request, res: Response) => {
  try {
    const ok = await ingestPayload(req); // <- só reqLike; retorna boolean
    return res.status(ok ? 200 : 400).json({ success: ok });
  } catch (err) {
    console.error("Erro ao enviar:", err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// ------ PRODUCTS ------
app.get("/products", async (_req: Request, res: Response) => {
  try {
    const items = await prisma.product.findMany();
    return res.json({ data: items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

app.get("/products/:slug", async (req: Request, res: Response) => {
  const slug = req.params.slug;
  try {
    const p = await prisma.product.findUnique({ where: { slug } });
    if (!p) return res.status(404).json({ error: "Produto não encontrado" });
    return res.json({ data: p });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao buscar produto" });
  }
});

// ------ ORDERS ------
app.get("/orders/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: { include: { product: true } } },
    });
    if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
    return res.json({ data: order });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erro ao buscar pedido" });
  }
});

// ------ CHECKOUT ------
app.post("/checkout", async (req: Request, res: Response) => {
  // 1) Requer sessão
  const token = req.cookies?.[COOKIE_NAME] || "";
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  let user: { sub: string; email: string; name: string };
  try {
    user = (await verifyJWT(token)) as any;
  } catch {
    return res.status(401).json({ error: "Sessão inválida/expirada." });
  }

  // 2) Body e validação básica
  const body = req.body as {
    items?: { productId: string; quantity: number | string }[];
  };
  if (!body?.items?.length) return res.status(400).json({ error: "Carrinho vazio." });

  const rawItems = body.items
    .map(({ productId, quantity }) => ({
      productId: String(productId),
      quantity: Number(quantity),
    }))
    .filter((i) => i.productId && Number.isFinite(i.quantity) && i.quantity > 0);

  if (!rawItems.length) return res.status(400).json({ error: "Carrinho inválido." });

  // 3) Carrega produtos e monta índice
  const ids = [...new Set(rawItems.map((i) => i.productId))];
  const dbProducts = await prisma.product.findMany({ where: { id: { in: ids } } });

  if (dbProducts.length !== ids.length) {
    const found = new Set(dbProducts.map((p: { id: any; }) => p.id));
    const missing = ids.filter((id) => !found.has(id));
    return res.status(400).json({ error: `Produto(s) não encontrado(s): ${missing.join(", ")}` });
  }

  const productById = new Map<string, Product>(dbProducts.map((p: { id: any; }) => [p.id, p]));

  // 4) Monta itens e valida estoque
  const items = rawItems.map(({ productId, quantity }) => {
    const p = productById.get(productId)!;
    if (p.stock < quantity) {
      const err: any = new Error(`Estoque insuficiente para ${p.name}`);
      err.code = 409;
      throw err;
    }
    return { productId: p.id, quantity, unitPriceCents: p.priceCents };
  });

  const totalCents = items.reduce((acc, i) => acc + i.unitPriceCents * i.quantity, 0);

  try {
    const order = await prisma.$transaction(async (tx: { product: { update: (arg0: { where: { id: string; }; data: { stock: { decrement: number; }; }; select: { id: boolean; stock: boolean; name: boolean; }; }) => any; }; order: { create: (arg0: { data: { email: string; userId: string; status: string; totalCents: number; items: { create: { productId: string; quantity: number; unitPriceCents: number; }[]; }; }; select: { id: boolean; totalCents: boolean; }; }) => any; }; }) => {
      for (const it of items) {
        const updated = await tx.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.quantity } },
          select: { id: true, stock: true, name: true },
        });
        if (updated.stock < 0) {
          const err: any = new Error(`Estoque insuficiente para ${updated.name}`);
          err.code = 409;
          throw err;
        }
      }
      return tx.order.create({
        data: {
          email: user.email,
          userId: user.sub,
          status: "CONFIRMED",
          totalCents,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
            })),
          },
        },
        select: { id: true, totalCents: true },
      });
    });

    const priceBRL = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return res.status(201).json({ ok: true, orderId: order.id, total: priceBRL(order.totalCents) });
  } catch (e: any) {
    if (e?.code === 409) return res.status(409).json({ error: e.message });
    if (e?.code === "P2025") return res.status(400).json({ error: "Produto não encontrado" });
    console.error("CHECKOUT ERROR:", e);
    return res.status(500).json({ error: "Erro no checkout" });
  }
});

// ------ AUTH ------
app.post("/register", async (req: Request, res: Response) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Campos obrigatórios." });

  const userExist = await prisma.user.findUnique({ where: { email } });
  if (userExist) return res.status(409).json({ error: "E-mail já cadastrado." });

  const user = {
    id: `u_${Math.random().toString(36).slice(2, 8)}`,
    name: String(name),
    email: String(email).trim().toLowerCase(),
    passwordHash: await hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  };
  await prisma.user.create({ data: user });

  const token = await signUserJWT({ id: user.id, email: user.email, name: user.name });
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });

  return res.status(201).json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha." });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  const token = await signUserJWT({ id: user.id, email: user.email, name: user.name });
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 7 });
  return res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS as any);
  return res.json({ ok: true });
});

app.get("/me", async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_NAME] || "";
  if (!token) return res.json({ user: null });
  try {
    const payload = await verifyJWT(token);
    return res.json({ user: { id: payload.sub, email: payload.email, name: payload.name } });
  } catch {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTS as any);
    return res.json({ user: null });
  }
});

// 404
app.use((_req: Request, res: Response) => res.status(404).json({ error: "Not Found" }));

// error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("API ERROR:", err);
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({ error: "Internal Server Error", details: isDev ? String(err) : undefined });
});
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`[dev] API ouvindo em http://localhost:${port}`);
});
export default app;
