import { test, expect } from '@playwright/test';

test.describe('WebGL Chunk Memory & Performance', () => {
  test('Canvas loads and context is created', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err));

    await page.goto('/');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeAttached();
    
    // Bypass the UI to avoid pointer-event interception issues
    await page.evaluate(() => {
      if (window.__START_GAME__) {
        window.__START_GAME__('slot1');
      }
    });
    await page.waitForTimeout(5000);
    const telemetry = await page.evaluate(() => {
      return {
        debugStats: window.__DEBUG_STATS__,
        workerTelemetry: window.__workerTelemetry,
        failedChunks: window.__DEBUG_STATS__?.failedChunks
      };
    });
    console.log('TELEMETRY:', JSON.stringify(telemetry, null, 2));

    // Wait until at least 1 visual mesh is rendered in the world
    await page.waitForFunction(() => {
      return window.__DEBUG_STATS__ && window.__DEBUG_STATS__.totalVisualMeshes > 0;
    }, { timeout: 15000 });
  });
});
