const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  let errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`Console Error: ${msg.text()}`);
    }
  });
  page.on('pageerror', error => {
    errors.push(`Page Error: ${error.message}`);
  });
  page.on('requestfailed', request => {
    errors.push(`Request Failed: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    console.log("Navigating to http://localhost:5175/...");
    await page.goto('http://localhost:5175/', { waitUntil: 'networkidle0', timeout: 15000 });
    
    // Wait an extra 2 seconds to see if React crashes after mounting
    await new Promise(r => setTimeout(r, 2000));
    
    // Check if the root div has content
    const rootHtml = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root ? root.innerHTML.substring(0, 100) : 'NO ROOT ELEMENT';
    });
    console.log("Root element starts with:", rootHtml);
    
  } catch (e) {
    console.error("Failed to load page:", e.message);
  } finally {
    if (errors.length > 0) {
      console.log("Found the following errors:");
      errors.forEach(e => console.log(e));
    } else {
      console.log("No errors found! Page loaded successfully.");
    }
    await browser.close();
  }
})();
