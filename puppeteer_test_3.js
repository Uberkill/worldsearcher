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
  
  // Click to start the game and initialize audio context and GameEngine!
  await page.click('body').catch(() => {});
  
  await new Promise(r => setTimeout(r, 8000));
  
  const stats = await page.evaluate(() => {
    const store = window.useStore ? window.useStore.getState() : null;
    const chunksKeys = store ? Object.keys(store.chunks) : [];
    let firstChunkStats = null;
    if (chunksKeys.length > 0) {
      const c = store.chunks[chunksKeys[0]];
      firstChunkStats = {
        key: chunksKeys[0],
        hasMeshArrays: !!c.meshArrays,
        solidPosLength: c.meshArrays?.solid?.pos?.length,
        solidColorLength: c.meshArrays?.solid?.color?.length,
      };
    }
    
    return {
      chunksRendered: window.__DEBUG_STATS__?.chunksRendered,
      sceneObjects: window.__DEBUG_SCENE__ ? window.__DEBUG_SCENE__.children.length : -1,
      numChunks: chunksKeys.length,
      firstChunkStats
    };
  });
  
  console.log('STATS:', JSON.stringify(stats, null, 2));
  
  await browser.close();
  viteProcess.kill();
  process.exit(0);
})();
