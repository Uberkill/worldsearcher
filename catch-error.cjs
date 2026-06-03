const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  // Start vite dev server
  const vite = spawn('npm', ['run', 'dev'], { shell: true });
  
  // Wait a few seconds for vite to start
  await new Promise(r => setTimeout(r, 5000));
  
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
  
  await page.goto('http://localhost:5173');
  
  console.log('Navigated to localhost:5173');
  await new Promise(r => setTimeout(r, 2000));
  
  // Click Start Singleplayer
  try {
    const startBtn = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => b.textContent.includes('Singleplayer'));
    });
    if (startBtn) {
        await startBtn.click();
        console.log('Clicked Singleplayer button');
        // Wait to see if it crashes
        await new Promise(r => setTimeout(r, 5000));
    } else {
        console.log('Could not find Singleplayer button');
    }
  } catch(e) {
    console.log('Error clicking:', e.message);
  }
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
