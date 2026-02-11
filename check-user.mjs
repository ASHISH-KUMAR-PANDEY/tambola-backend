import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUser() {
  try {
    console.log('Searching for userId: 66d82fddce84f9482889e0d1\n');

    // Check specific user
    const user = await prisma.user.findUnique({
      where: { id: '66d82fddce84f9482889e0d1' },
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        role: true,
        createdAt: true,
      },
    });

    if (user) {
      console.log('✅ User found:');
      console.log(`ID: ${user.id}`);
      console.log(`Name: ${user.name || '(no name set)'}`);
      console.log(`Email: ${user.email || '(no email)'}`);
      console.log(`Mobile: ${user.mobileNumber || '(no mobile)'}`);
      console.log(`Role: ${user.role}`);
      console.log(`Created: ${user.createdAt}`);
    } else {
      console.log('❌ User not found in database');

      // Check total user count
      const userCount = await prisma.user.count();
      console.log(`\nTotal users in database: ${userCount}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();
