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
        const btn = btns.find(b => b.textContent.includes('SOLO PLAY'));
        if (btn) btn.click();
  });
  
  console.log('Clicked SOLO PLAY button');
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('*'));
        const btn = els.find(b => b.textContent && b.textContent.includes('NEW JOURNEY'));
        if (btn) btn.click();
  });
  console.log('Clicked Start new game button');

  await new Promise(r => setTimeout(r, 5000));
  
  await page.screenshot({ path: 'screenshot.png' });
  const html = await page.content();
  require('fs').writeFileSync('dom.html', html);
  console.log('DOM length:', html.length);
  
  await browser.close();
  vite.kill();
  process.exit(0);
})();
