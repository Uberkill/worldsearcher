import { test, expect } from '@playwright/test';

test.describe('End-to-End Multiplayer Full Simulation: Connect, Move, Voxel Delta, Ship Piloting & Telemetry', () => {
  test('Complete multiplayer workflow with two real browser contexts', async ({ browser }) => {
    test.setTimeout(90000);

    // 1. Create two isolated browser contexts for Host and Guest
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    hostPage.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('LookupType') && !text.includes('DevTools')) {
        console.log('[HOST]:', text);
      }
    });

    guestPage.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('LookupType') && !text.includes('DevTools')) {
        console.log('[GUEST]:', text);
      }
    });

    // 2. Start Host Game in slot1
    console.log('[TEST] Step 1: Booting Host in slot1...');
    await hostPage.goto('/');
    await hostPage.waitForFunction(() => typeof (window as any).__START_GAME__ === 'function');
    await hostPage.evaluate(() => {
      (window as any).__START_GAME__('slot1');
    });

    // Wait for Host game engine and chunks to initialize
    await hostPage.waitForFunction(() => {
      const store = (window as any).useChunkStore?.getState();
      const chunk = store?.chunks?.['0,0'];
      return !!(chunk && chunk.buffer && chunk.buffer.length > 0);
    }, { timeout: 20000 });

    // 3. Host creates multiplayer room
    console.log('[TEST] Step 2: Host generating multiplayer room code...');
    const roomCode = await hostPage.evaluate(async () => {
      const net = (window as any).networkActions;
      net.getState().setPlayerName('HostCaptain');
      await net.getState().hostGame();

      for (let i = 0; i < 150; i++) {
        const code = net.getState().roomCode;
        if (code && code.length >= 6) return code;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Host failed to obtain room code');
    });

    expect(roomCode).toBeTruthy();
    expect(roomCode.length).toBeGreaterThanOrEqual(6);
    console.log('[TEST] Room code generated:', roomCode);

    // 4. Guest joins game via room code
    console.log('[TEST] Step 3: Guest connecting to room', roomCode);
    await guestPage.goto('/');
    await guestPage.waitForFunction(() => typeof (window as any).networkActions !== 'undefined');

    const guestConnected = await guestPage.evaluate(async (code) => {
      const net = (window as any).networkActions;
      net.getState().setPlayerName('GuestNavigator');
      await net.getState().joinGame(code);

      for (let i = 0; i < 200; i++) {
        if (net.getState().connectionStatus === 'connected') return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    }, roomCode);

    expect(guestConnected).toBe(true);

    // Wait for Guest world to boot and chunk 0,0 to populate
    await guestPage.waitForFunction(() => {
      const store = (window as any).useChunkStore?.getState();
      const chunk = store?.chunks?.['0,0'];
      return !!(chunk && chunk.buffer && chunk.buffer.length > 0);
    }, { timeout: 25000 });

    console.log('[TEST] Step 4: WebRTC connected and chunk 0,0 initialized on both sides');

    // 5. Positional Movement Synchronization
    console.log('[TEST] Step 5: Testing continuous 30Hz positional movement sync...');
    await guestPage.evaluate(() => {
      const g = (window as any).__WORLD_SEARCH_GLOBALS__ || window;
      const pos = g.playerPosition || (window as any).playerPosition;
      pos.x = 45.5;
      pos.y = 264.0;
      pos.z = -22.25;
    });

    await hostPage.waitForFunction(() => {
      const net = (window as any).networkActions.getState();
      for (const id in net.players) {
        const p = net.players[id];
        if (p.x !== undefined && Math.abs(p.x - 45.5) < 0.5 && Math.abs(p.z - (-22.25)) < 0.5) {
          return true;
        }
        if (p.positionBuffer && p.positionBuffer.length > 0) {
          const latest = p.positionBuffer[p.positionBuffer.length - 1];
          if (Math.abs(latest.x - 45.5) < 0.5 && Math.abs(latest.z - (-22.25)) < 0.5) {
            return true;
          }
        }
      }
      return false;
    }, { timeout: 10000 });
    console.log('[TEST] Host successfully tracked Guest movement to (45.5, 264.0, -22.25)');

    await hostPage.evaluate(() => {
      const g = (window as any).__WORLD_SEARCH_GLOBALS__ || window;
      const pos = g.playerPosition || (window as any).playerPosition;
      pos.x = -18.0;
      pos.y = 261.5;
      pos.z = 80.0;
    });

    await guestPage.waitForFunction(() => {
      const net = (window as any).networkActions.getState();
      for (const id in net.players) {
        const p = net.players[id];
        if (p.x !== undefined && Math.abs(p.x - (-18.0)) < 0.5 && Math.abs(p.z - 80.0) < 0.5) {
          return true;
        }
        if (p.positionBuffer && p.positionBuffer.length > 0) {
          const latest = p.positionBuffer[p.positionBuffer.length - 1];
          if (Math.abs(latest.x - (-18.0)) < 0.5 && Math.abs(latest.z - 80.0) < 0.5) {
            return true;
          }
        }
      }
      return false;
    }, { timeout: 10000 });
    console.log('[TEST] Guest successfully tracked Host movement to (-18.0, 261.5, 80.0)');

    // 6. Voxel Building & Destruction (BLOCK_DELTA) Synchronization
    console.log('[TEST] Step 6: Testing bidirectional voxel building & breaking delta sync...');
    const testBlock = { x: 2, y: 200, z: 2 };
    const chunkKey = '0,0';
    const CHUNK_Y_MIN = -32;
    const testIndex = (testBlock.y - CHUNK_Y_MIN) * 256 + testBlock.z * 16 + testBlock.x;

    // Guest places a block
    const addResult = await guestPage.evaluate(({ x, y, z }) => {
      const store = (window as any).__USE_STORE__.getState();
      return store.addCube(x, y, z);
    }, testBlock);
    expect(addResult).toBe(true);

    // Host should receive BLOCK_DELTA binary packet and update its chunk buffer
    await hostPage.waitForFunction(({ key, idx }) => {
      const store = (window as any).useChunkStore?.getState();
      const chunk = store?.chunks?.[key];
      if (!chunk || !chunk.buffer) return false;
      const texId = chunk.buffer[idx] & 0xff;
      return texId > 0;
    }, { key: chunkKey, idx: testIndex }, { timeout: 10000 });
    console.log('[TEST] Host received Guest block placement at', testBlock);

    // Host destroys the block
    await hostPage.evaluate(({ x, y, z }) => {
      const store = (window as any).__USE_STORE__.getState();
      store.removeCube(x, y, z);
    }, testBlock);

    // Guest should receive BLOCK_DELTA and update its chunk buffer to air (0)
    await guestPage.waitForFunction(({ key, idx }) => {
      const store = (window as any).useChunkStore?.getState();
      const chunk = store?.chunks?.[key];
      if (!chunk || !chunk.buffer) return false;
      const texId = chunk.buffer[idx] & 0xff;
      return texId === 0;
    }, { key: chunkKey, idx: testIndex }, { timeout: 10000 });
    console.log('[TEST] Guest received Host block removal at', testBlock);

    // 7. Boat / Ship System: Activation, Seating, Steering & Transform Sync
    console.log('[TEST] Step 7: Testing ship system activation, boarding & steering...');

    // Host spawns / activates ship structure
    await hostPage.evaluate(() => {
      const store = (window as any).__USE_STORE__.getState();
      store.initializeShip();
      store.setShipTransform('default', [100, 270, 100], [0, 0, 0], true);
      (window as any).__forceShipBroadcast = true;
    });

    // Guest verifies ship activation and physical coordinates
    await guestPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      const transforms = (window as any).shipTransforms || (window as any).__WORLD_SEARCH_GLOBALS__?.shipTransforms;
      const t = transforms ? transforms.get('default') : null;
      return store.isShipActive === true && t && Math.abs(t.position.x - 100) < 1.0;
    }, { timeout: 10000 });
    console.log('[TEST] Guest synchronized active ship structure and initial position (100, 270, 100)');

    // Guest requests helm to sit on the boat
    await guestPage.evaluate(() => {
      const net = (window as any).networkActions.getState();
      net.broadcastEvent({ type: 'REQUEST_HELM', playerId: net.playerId, force: true });
    });

    // Both Host and Guest verify Guest is seated at helm
    await guestPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      const net = (window as any).networkActions.getState();
      return store.isSeated === true && store.shipHelmPlayerId === net.playerId;
    }, { timeout: 10000 });

    await hostPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      return !!store.shipHelmPlayerId;
    }, { timeout: 10000 });
    console.log('[TEST] Guest successfully boarded and assumed helm control');

    // Guest sends steering intent (forward + turnLeft)
    await guestPage.evaluate(() => {
      const net = (window as any).networkActions.getState();
      net.broadcastEvent({
        type: 'SHIP_STEER_INTENT',
        playerId: net.playerId,
        forward: true,
        backward: false,
        turnLeft: true,
        turnRight: false,
        ascend: false,
        descend: false
      });
    });

    // Host receives steering intent from Guest
    await hostPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      const intents = store.shipSteerIntents || {};
      for (const id in intents) {
        if (intents[id]?.forward === true && intents[id]?.turnLeft === true) return true;
      }
      return false;
    }, { timeout: 10000 });
    console.log('[TEST] Host received live steering intent from seated Guest');

    // Host updates authoritative ship coordinates and broadcasts new transform
    await hostPage.evaluate(() => {
      const store = (window as any).__USE_STORE__.getState();
      store.setShipTransform('default', [135, 276, 150], [0, 0.45, 0], true);
      (window as any).__forceShipBroadcast = true;
    });

    // Guest tracks updated ship transform in real-time
    await guestPage.waitForFunction(() => {
      const transforms = (window as any).shipTransforms || (window as any).__WORLD_SEARCH_GLOBALS__?.shipTransforms;
      const t = transforms ? transforms.get('default') : null;
      return t && Math.abs(t.position.x - 135) < 1.0 && Math.abs(t.position.z - 150) < 1.0;
    }, { timeout: 10000 });
    console.log('[TEST] Guest synchronized dynamic ship transform update at (135, 276, 150)');

    // Guest dismounts and releases helm
    await guestPage.evaluate(() => {
      const net = (window as any).networkActions.getState();
      net.broadcastEvent({ type: 'RELEASE_HELM', playerId: net.playerId });
    });

    // Both sides verify helm is released and player is unseated
    await guestPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      return store.isSeated === false && store.shipHelmPlayerId === null;
    }, { timeout: 10000 });

    await hostPage.waitForFunction(() => {
      const store = (window as any).__USE_STORE__.getState();
      return store.shipHelmPlayerId === null;
    }, { timeout: 10000 });
    console.log('[TEST] Guest successfully dismounted and released helm');

    // 8. Bidirectional In-Game Chat
    console.log('[TEST] Step 8: Testing bidirectional in-game chat...');
    await guestPage.evaluate(() => {
      const net = (window as any).networkActions.getState();
      net.broadcastChatMessage('Expedition complete. Docking ship.');
    });

    await hostPage.waitForFunction(() => {
      const net = (window as any).networkActions.getState();
      const messages = net.chatMessages || [];
      return messages.some((m: any) => m.text && m.text.includes('Expedition complete. Docking ship.'));
    }, { timeout: 10000 });
    console.log('[TEST] Host received chat message from Guest');

    // 9. Comprehensive Telemetry Audit
    console.log('[TEST] Step 9: Auditing telemetry metrics on Host and Guest...');
    const hostStats = await hostPage.evaluate(() => {
      const stats = (window as any).__DEBUG_STATS__ || {};
      return {
        bytesSent: stats.bytesSent || 0,
        bytesReceived: stats.bytesReceived || 0,
        packetStats: stats.packetStats,
      };
    });

    const guestStats = await guestPage.evaluate(() => {
      const stats = (window as any).__DEBUG_STATS__ || {};
      return {
        bytesSent: stats.bytesSent || 0,
        bytesReceived: stats.bytesReceived || 0,
        packetStats: stats.packetStats,
      };
    });

    console.log('[TEST] Final Host Telemetry:', JSON.stringify(hostStats, null, 2));
    console.log('[TEST] Final Guest Telemetry:', JSON.stringify(guestStats, null, 2));

    expect(hostStats.bytesSent).toBeGreaterThan(1000);
    expect(hostStats.bytesReceived).toBeGreaterThan(1000);
    expect(guestStats.bytesSent).toBeGreaterThan(1000);
    expect(guestStats.bytesReceived).toBeGreaterThan(1000);

    // Verify binary and event packet tracking in packetStats
    expect(hostStats.packetStats.sent['PLAYER_MOVE']).toBeGreaterThan(0);
    expect(hostStats.packetStats.recv['PLAYER_MOVE']).toBeGreaterThan(0);
    expect(hostStats.packetStats.sent['SHIP_TRANSFORM']).toBeGreaterThan(0);

    console.log('[TEST] All multiplayer scenarios verified successfully');

    await hostContext.close();
    await guestContext.close();
  });
});
