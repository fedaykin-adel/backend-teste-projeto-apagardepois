import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.product.count();
  if (count > 0) {
    console.log("Seed: já existem produtos, pulando.");
    return;
  }
  await prisma.product.createMany({
    data: [
      {
        slug: "camiseta-fremen",
        name: "Camiseta Fremen",
        description: "Camiseta básica 100% algodão com estampa minimalista.",
        priceCents: 7990,
        imageUrl: "https://picsum.photos/seed/fremen/600/600",
        category: "apparel",
        stock: 24,
      },
      {
        slug: "mochila-deserto",
        name: "Mochila do Deserto",
        description: "Mochila leve e resistente para o dia a dia.",
        priceCents: 19990,
        imageUrl: "https://picsum.photos/seed/desertpack/600/600",
        category: "bags",
        stock: 12,
      },
      {
        slug: "canteen-arena",
        name: "Cantil Arena",
        description: "Cantil térmico 1L em aço inoxidável.",
        priceCents: 12990,
        imageUrl: "https://picsum.photos/seed/canteen/600/600",
        category: "outdoor",
        stock: 40,
      },
      {
        slug: "jaqueta-tempestade",
        name: "Jaqueta Tempestade",
        description: "Corta-vento leve com capuz ajustável.",
        priceCents: 27990,
        imageUrl: "https://picsum.photos/seed/stormjacket/600/600",
        category: "apparel",
        stock: 7,
      },
      {
        slug: "oculos-duna",
        name: "Óculos Duna",
        description: "Proteção UV400 com acabamento fosco.",
        priceCents: 9990,
        imageUrl: "https://picsum.photos/seed/dunaglasses/600/600",
        category: "accessories",
        stock: 18,
      },
      {
        slug: "bota-trilha",
        name: "Bota Trilha",
        description: "Solado antiderrapante e palmilha confortável.",
        priceCents: 34990,
        imageUrl: "https://picsum.photos/seed/boottrail/600/600",
        category: "footwear",
        stock: 9,
      },
    ],
  });
  console.log("Seed: produtos inseridos.");
}

main().finally(async () => prisma.$disconnect());
