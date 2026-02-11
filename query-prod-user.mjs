// Query production API to get user info
const userId = '66d82fddce84f9482889e0d1';

console.log(`Querying production backend for userId: ${userId}\n`);

// Try to get user info via API (if there's an endpoint)
const apiUrl = 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

// Check health first
fetch(`${apiUrl}/health`)
  .then(res => res.json())
  .then(data => {
    console.log('✅ Backend is healthy:', data);
    console.log('\n⚠️  No public API endpoint to query user by ID');
    console.log('User ID needs to be checked from logs or database directly');
    console.log('\nUser ID:', userId);
    console.log('This appears to be a MongoDB ObjectId format (24 hex chars)');
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
  });
