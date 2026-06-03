const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  const vite = spawn('npm', ['run', 'dev'], { shell: true });
  await new Promise(r => setTimeout(r, 5000));
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  const errors = [];
  const logs = [];
  
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  await page.goto('http://localhost:5173');
  await new Promise(r => setTimeout(r, 3000));
  
  // Step 1: Click SOLO PLAY
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('SOLO PLAY'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 2: Click the save slot button
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const slot = btns.find(b => b.textContent.includes('NEW JOURNEY'));
    if (slot) {
      slot.click();
      console.log('DIAG: Clicked slot button');
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));

  // Step 3: Click the ACTUAL "INITIALIZE VISOR" button that appears AFTER clicking the slot
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const start = btns.find(b => b.textContent.includes('INITIALIZE VISOR') || b.textContent.includes('INITIATE'));
    if (start) {
      start.click();
      console.log('DIAG: Clicked initiate button');
    } else {
       // Just find any button in the lower right that starts the game
       const initiateBtn = document.querySelector('button.bg-cyan-500\\/20'); // The green action button
       if(initiateBtn) { initiateBtn.click(); console.log('DIAG: Clicked action button by class'); }
    }
  });

  console.log('Waiting for game to load...');
  
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const state = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[id="main-webgl-canvas"]');
      const loadingEl = document.querySelector('.bg-\\[\\#0b0c10\\]\\/90');
      return {
        hasGameCanvas: !!canvas,
        loadingVisible: !!loadingEl
      };
    });
    console.log(`  Check ${i+1}: gameCanvas=${state.hasGameCanvas}, loading=${state.loadingVisible}`);
    
    if (state.hasGameCanvas) {
      await page.screenshot({ path: `diag_game_real_${i}.png` });
    }
  }
  
  await page.screenshot({ path: 'diag_final_real.png' });
  
  const finalState = await page.evaluate(() => {
    const appHTML = document.getElementById('root').innerHTML.substring(0, 500);
    return { appHTML };
  });
  
  fs.writeFileSync('diag_full_real.json', JSON.stringify({ finalState, errors, logs }, null, 2));
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
