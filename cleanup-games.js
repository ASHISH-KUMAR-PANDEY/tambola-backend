// Cleanup script to delete all game data
import mongoose from 'mongoose';
import { Game, Player, Winner } from './dist/models/index.js';

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://tambola:tambola_dev_password@localhost:27017/tambola_db?authSource=admin';

async function cleanup() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URL);
    console.log('Connected to MongoDB');

    // Count existing records
    const gameCount = await Game.countDocuments();
    const playerCount = await Player.countDocuments();
    const winnerCount = await Winner.countDocuments();

    console.log('\n📊 Current Database Status:');
    console.log(`  Games: ${gameCount}`);
    console.log(`  Players: ${playerCount}`);
    console.log(`  Winners: ${winnerCount}`);

    if (gameCount === 0 && playerCount === 0 && winnerCount === 0) {
      console.log('\n✅ Database is already clean. No data to delete.');
      process.exit(0);
    }

    console.log('\n🗑️  Deleting all game data...');

    // Delete all data
    await Winner.deleteMany({});
    console.log('  ✅ Deleted all winners');

    await Player.deleteMany({});
    console.log('  ✅ Deleted all players');

    await Game.deleteMany({});
    console.log('  ✅ Deleted all games');

    // Verify deletion
    const remainingGames = await Game.countDocuments();
    const remainingPlayers = await Player.countDocuments();
    const remainingWinners = await Winner.countDocuments();

    console.log('\n📊 Database Status After Cleanup:');
    console.log(`  Games: ${remainingGames}`);
    console.log(`  Players: ${remainingPlayers}`);
    console.log(`  Winners: ${remainingWinners}`);

    if (remainingGames === 0 && remainingPlayers === 0 && remainingWinners === 0) {
      console.log('\n✅ All game data successfully deleted!');
    } else {
      console.log('\n⚠️  Warning: Some data may remain in the database');
    }

    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

cleanup();
