import puppeteer from 'puppeteer';

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning' || type === 'log') {
      console.log(`BROWSER [${type.toUpperCase()}]: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`BROWSER [PAGE ERROR]: ${error.message}`);
  });

  page.on('requestfailed', request => {
    console.log(`BROWSER [REQ FAILED]: ${request.url()} - ${request.failure()?.errorText}`);
  });

  console.log('Navigating to http://localhost:5173 ...');
  try {
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle2', timeout: 10000 });
  } catch (e) {
    console.log('Navigation error:', e.message);
  }

  // Click anywhere to start the game
  console.log('Clicking to bypass start menu...');
  try {
    await page.click('body');
  } catch(e) {}

  console.log('Waiting for 5 seconds to capture logs...');
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log('Done.');
})();
