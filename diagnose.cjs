const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  const vite = spawn('npm', ['run', 'dev'], { shell: true });
  await new Promise(r => setTimeout(r, 5000));
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  const logs = [];
  const errors = [];
  
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log('BROWSER ' + msg.type().toUpperCase() + ':', text);
    }
  });
  page.on('pageerror', error => {
    errors.push(error.message);
    console.log('PAGE ERROR:', error.message);
  });
  
  await page.goto('http://localhost:5173');
  await new Promise(r => setTimeout(r, 3000));
  
  // Step 1: Click SOLO PLAY
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('SOLO PLAY'));
    if (btn) { btn.click(); console.log('DIAG: Clicked SOLO PLAY'); }
    else console.log('DIAG: SOLO PLAY not found. Buttons: ' + btns.map(b => b.textContent.trim()).join(' | '));
  });
  await new Promise(r => setTimeout(r, 2000));
  
  await page.screenshot({ path: 'diag_step1.png' });
  
  // Step 2: Click the first save slot (EMPTY SLOT 1 / NEW JOURNEY)
  await page.evaluate(() => {
    // Try clicking the actual save-slot card
    const allEls = Array.from(document.querySelectorAll('div, button'));
    const slot = allEls.find(el => {
      const text = el.textContent || '';
      return text.includes('EMPTY SLOT 1') && el.onclick !== undefined;
    });
    if (slot) { slot.click(); console.log('DIAG: Clicked EMPTY SLOT 1 via onclick'); return; }
    
    // Fallback: Try clicking any element that has "EMPTY SLOT 1" text  
    const slot2 = allEls.find(el => {
      const text = (el.textContent || '').trim();
      return text.includes('EMPTY SLOT 1') || text.includes('NEW JOURNEY');
    });
    if (slot2) { slot2.click(); console.log('DIAG: Clicked slot via text match: ' + slot2.tagName); return; }
    
    // Fallback: just click any clickable save slot
    const cards = document.querySelectorAll('[class*="slot"], [class*="save"], [class*="card"]');
    if (cards.length > 0) { cards[0].click(); console.log('DIAG: Clicked first card element'); return; }
    
    console.log('DIAG: Could not find save slot to click');
    console.log('DIAG: All visible text snippets: ' + allEls.slice(0, 20).map(e => e.textContent?.trim().substring(0, 50)).join(' | '));
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'diag_step2.png' });
  
  // Step 3: Wait for the game to load (loading screen -> world ready)
  console.log('Waiting for game to load...');
  await new Promise(r => setTimeout(r, 10000));
  
  await page.screenshot({ path: 'diag_step3.png' });
  
  // Dump state
  const state = await page.evaluate(() => {
    try {
      // Check if the canvas is visible
      const canvas = document.querySelector('canvas');
      const canvasInfo = canvas ? {
        width: canvas.width, height: canvas.height,
        display: canvas.style.display,
        visibility: canvas.style.visibility,
        opacity: canvas.style.opacity,
      } : null;
      
      // Check for error boundary
      const errorEl = document.querySelector('[class*="error"], [class*="Error"]');
      const errorText = errorEl ? errorEl.textContent : null;
      
      // Check loading screen
      const loadingEl = document.querySelector('[class*="loading"], [class*="Loading"]');
      const loadingText = loadingEl ? loadingEl.textContent?.substring(0, 200) : null;
      
      // Check what's actually visible
      const root = document.getElementById('root');
      const rootChildren = root ? root.children.length : 0;
      const rootHTML = root ? root.innerHTML.substring(0, 500) : 'NO ROOT';
      
      return { canvasInfo, errorText, loadingText, rootChildren, rootHTML };
    } catch (e) {
      return { error: e.message };
    }
  });
  
  console.log('\n=== DIAGNOSIS RESULTS ===');
  console.log('Canvas:', JSON.stringify(state.canvasInfo, null, 2));
  console.log('Error boundary:', state.errorText);
  console.log('Loading screen:', state.loadingText);
  console.log('Root children:', state.rootChildren);
  console.log('Root HTML (first 500):', state.rootHTML);
  console.log('\n=== PAGE ERRORS ===');
  errors.forEach(e => console.log('  ERROR:', e));
  console.log('\n=== CONSOLE LOGS (filtered) ===');
  logs.filter(l => l.includes('DIAG:') || l.includes('error') || l.includes('Error') || l.includes('crash'))
    .forEach(l => console.log('  ', l));
  
  // Save everything
  fs.writeFileSync('diag_logs.json', JSON.stringify({ state, errors, logs }, null, 2));
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
