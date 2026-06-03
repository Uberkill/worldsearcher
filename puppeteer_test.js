import puppeteer from 'puppeteer';
import { spawn } from 'child_process';

(async () => {
  // Start vite dev server
  const viteProcess = spawn('npm', ['run', 'dev'], { cwd: 'C:\\Users\\oob\\.gemini\\antigravity\\scratch\\Worldsearchyou', shell: true });
  
  let viteReady = false;
  viteProcess.stdout.on('data', (data) => {
    if (data.toString().includes('Local:')) {
      viteReady = true;
    }
  });

  // Wait for vite to start
  for(let i = 0; i < 20; i++) {
    if(viteReady) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  
  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 3000)); // wait a bit for WebGL to initialize and compile shaders
  
  await browser.close();
  viteProcess.kill();
  process.exit(0);
})();
