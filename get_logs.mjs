import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  let chunkCount = 0;
  let errors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('scratchCol')) errors.push(text);
    if (text.includes('Worker error')) errors.push(text);
  });
  
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));
    
    // Click SOLO PLAY
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent.includes('SOLO PLAY')) { btn.click(); return; }
      }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Click first save slot
    await page.evaluate(() => {
      const slots = document.querySelectorAll('[class*="cursor-pointer"]');
      if (slots.length > 0) slots[0].click();
    });
    
    console.log("Game starting... waiting 12s for chunks...");
    await new Promise(r => setTimeout(r, 12000));
    
    console.log(`\n=== VERIFICATION ===`);
    console.log(`Worker errors: ${errors.length}`);
    errors.slice(0, 5).forEach(e => console.log(`  ERROR: ${e}`));
    if (errors.length === 0) console.log("  ✅ No worker errors!");
    
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await browser.close();
  }
})();
