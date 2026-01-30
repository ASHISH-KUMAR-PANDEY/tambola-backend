import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { User } from '../src/models/index.js';

const SALT_ROUNDS = 10;
const NEW_PASSWORD = '12345678';

async function updateTestPasswords() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URL || 'mongodb://localhost:27017/tambola';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Hash the new password
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);
    console.log('Password hashed');

    // Update organizer@test.com
    const organizer = await User.findOneAndUpdate(
      { email: 'organizer@test.com' },
      { password: hashedPassword },
      { new: true }
    );

    if (organizer) {
      console.log('✓ Updated password for organizer@test.com');
    } else {
      console.log('✗ User organizer@test.com not found');
    }

    // Update player1@test.com
    const player = await User.findOneAndUpdate(
      { email: 'player1@test.com' },
      { password: hashedPassword },
      { new: true }
    );

    if (player) {
      console.log('✓ Updated password for player1@test.com');
    } else {
      console.log('✗ User player1@test.com not found');
    }

    console.log('\nBoth accounts now have password: 12345678');

    // Disconnect
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error updating passwords:', error);
    process.exit(1);
  }
}

updateTestPasswords();
