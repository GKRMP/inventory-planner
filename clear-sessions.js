import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.session.deleteMany({
    where: {
      shop: 'rmp-anal-dev.myshopify.com'
    }
  });
  console.log(`Deleted ${result.count} session(s)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
