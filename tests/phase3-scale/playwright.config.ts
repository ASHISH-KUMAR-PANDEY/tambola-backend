import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Phase 3 Scale Testing
 */
export default defineConfig({
  testDir: './scenarios',

  // Maximum time one test can run
  timeout: 30 * 60 * 1000, // 30 minutes (for long-running scale tests)

  // Maximum time for each assertion
  expect: {
    timeout: 10000, // 10 seconds
  },

  // Run tests sequentially (scale tests should not run in parallel)
  fullyParallel: false,
  workers: 1,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-results.json' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for browser navigation
    baseURL: process.env.FRONTEND_URL || 'https://main.d262mxsv2xemak.amplifyapp.com',

    // Collect trace on failure
    trace: 'retain-on-failure',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Maximum time for each action
    actionTimeout: 15000, // 15 seconds

    // Maximum time for navigation
    navigationTimeout: 30000, // 30 seconds
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Launch options
        launchOptions: {
          args: [
            '--disable-dev-shm-usage', // Prevent shared memory issues
            '--no-sandbox', // Required for some CI environments
          ],
        },
      },
    },
  ],

  // Web server configuration (if needed)
  // webServer: {
  //   command: 'npm run start',
  //   port: 3000,
  //   reuseExistingServer: !process.env.CI,
  // },
});
