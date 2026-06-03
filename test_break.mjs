import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  let logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    console.log(`[BROWSER] ${msg.text()}`);
  });
  page.on('pageerror', error => console.error(`[PAGE_ERROR] ${error.message}`));

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent.includes('SOLO PLAY')) { btn.click(); return; }
      }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    await page.evaluate(() => {
      const slots = document.querySelectorAll('[class*="cursor-pointer"]');
      if (slots.length > 0) slots[0].click();
    });
    
    console.log("Game starting... waiting 10s for chunks to generate...");
    await new Promise(r => setTimeout(r, 10000));

    // Now let's try to break a block
    console.log("Breaking a block...");
    const result = await page.evaluate(async () => {
       const store = window.useStore ? window.useStore.getState() : null;
       if (!store) return "No store";
       
       const chunkKey = "0,0";
       const chunk = store.chunks[chunkKey];
       if (!chunk || !chunk.buffer) return "No chunk 0,0";

       let foundBlock = null;
       for (let y = 160; y >= 0; y--) {
         // Assuming getIndex(0, y, 0)
         const idx = (y - -64) * 256 + 0 * 16 + 0;
         if (chunk.buffer[idx] !== 0) {
           foundBlock = { x: 0, y, z: 0 };
           break;
         }
       }

       if (!foundBlock) return "No block found in column 0,0";

       let initialRebuildId = chunk.rebuildId || 0;
       console.log(`Removing cube at ${foundBlock.x}, ${foundBlock.y}, ${foundBlock.z}`);
       store.removeCube(foundBlock.x, foundBlock.y, foundBlock.z);
       
       // Wait for worker to rebuild
       await new Promise(r => setTimeout(r, 2000));
       
       const newStore = window.useStore.getState();
       const newChunk = newStore.chunks[chunkKey];
       
       return {
         chunkKey,
         initialRebuildId,
         newRebuildId: newChunk?.rebuildId,
         physicsRebuildId: newChunk?.physicsRebuildId,
         pendingMounts: newStore.pendingMeshMounts.length,
         overflows: newStore.overflowChunks,
       };
    });
    
    console.log("Result:");
    console.log(JSON.stringify(result, null, 2));
    
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await browser.close();
  }
})();
