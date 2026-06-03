const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const vite = spawn('npm', ['run', 'dev'], { shell: true });
  await new Promise(r => setTimeout(r, 5000));
  
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
  
  await page.goto('http://localhost:5173');
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Singleplayer'));
        if (btn) btn.click();
  });
  
  console.log('Clicked Singleplayer button');
  await new Promise(r => setTimeout(r, 5000));
  
  await page.screenshot({ path: 'screenshot.png' });
  const html = await page.content();
  console.log('DOM length:', html.length);
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
