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
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
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
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 2: Click the first save slot card (the entire div is clickable)
  await page.evaluate(() => {
    // The save slot cards are divs with onClick — find the card containing "EMPTY SLOT 1"
    const cards = Array.from(document.querySelectorAll('div'));
    // Find the most specific card (smallest innerHTML) that contains EMPTY SLOT
    const candidates = cards.filter(d => {
      const t = d.textContent || '';
      return t.includes('EMPTY SLOT 1') && t.includes('NEW JOURNEY');
    });
    // Sort by innerHTML length ascending to get the most specific element
    candidates.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
    if (candidates.length > 0) {
      candidates[0].click();
      console.log('DIAG: Clicked save slot card');
    } else {
      console.log('DIAG: No save slot card found');
    }
  });
  
  console.log('Clicked save slot, waiting for game to load...');
  
  // Wait for game to fully load (loading screen + chunk generation)
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const state = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-engine]');
      const loadingEl = document.querySelector('[class*="loading"], [class*="Loading"]');
      return {
        hasGameCanvas: !!canvas,
        canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
        loadingVisible: loadingEl ? loadingEl.style.display !== 'none' : false,
        bodyHTML: document.body.innerHTML.substring(0, 200),
      };
    });
    console.log(`  Check ${i+1}: canvas=${state.hasGameCanvas} (${state.canvasSize}), loading=${state.loadingVisible}`);
    
    if (state.hasGameCanvas) {
      await page.screenshot({ path: `diag_game_${i}.png` });
    }
  }
  
  // Final state dump
  await page.screenshot({ path: 'diag_final.png' });
  
  const finalState = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-engine]');
    const allCanvases = document.querySelectorAll('canvas');
    const root = document.getElementById('root');
    
    // Check for visible elements
    const visibleEls = [];
    root.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
        if (el.tagName === 'CANVAS' || el.tagName === 'DIV' || el.tagName === 'BUTTON') {
          visibleEls.push({
            tag: el.tagName,
            class: (el.className || '').toString().substring(0, 80),
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            zIndex: style.zIndex,
          });
        }
      }
    });
    
    return {
      canvasCount: allCanvases.length,
      gameCanvas: canvas ? { w: canvas.width, h: canvas.height, display: canvas.style.display } : null,
      visibleElements: visibleEls.slice(0, 30),
      rootHTML: root.innerHTML.substring(0, 300),
    };
  });
  
  console.log('\n=== FINAL DIAGNOSIS ===');
  console.log('Canvas count:', finalState.canvasCount);
  console.log('Game canvas:', JSON.stringify(finalState.gameCanvas));
  console.log('Visible elements:', JSON.stringify(finalState.visibleElements, null, 2));
  console.log('\n=== ERRORS ===');
  errors.forEach(e => console.log('  ', e));
  console.log('\n=== DIAG LOGS ===');
  logs.filter(l => l.includes('DIAG:')).forEach(l => console.log('  ', l));
  
  fs.writeFileSync('diag_full.json', JSON.stringify({ finalState, errors, logs }, null, 2));
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
