import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUserName() {
  try {
    const user = await prisma.user.findUnique({
      where: { id: '66d82fddce84f9482889e0d1' },
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        role: true,
      },
    });

    if (user) {
      console.log('User found:');
      console.log(JSON.stringify(user, null, 2));
    } else {
      console.log('User not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserName();
