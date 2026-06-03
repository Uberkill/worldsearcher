import puppeteer from 'puppeteer';
import { spawn } from 'child_process';

(async () => {
  const viteProcess = spawn('npm', ['run', 'dev'], { cwd: 'C:\\Users\\oob\\.gemini\\antigravity\\scratch\\Worldsearchyou', shell: true });
  
  let viteReady = false;
  viteProcess.stdout.on('data', (data) => {
    if (data.toString().includes('Local:')) {
      viteReady = true;
    }
  });

  for(let i = 0; i < 20; i++) {
    if(viteReady) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 6000));
  
  const stats = await page.evaluate(() => {
    return {
      chunksRendered: window.__DEBUG_STATS__?.chunksRendered,
      sceneObjects: window.__DEBUG_SCENE__ ? window.__DEBUG_SCENE__.children.length : -1,
      // Try to find any chunk geometry and log its pos count
    };
  });
  
  console.log('STATS:', stats);
  
  await browser.close();
  viteProcess.kill();
  process.exit(0);
})();
