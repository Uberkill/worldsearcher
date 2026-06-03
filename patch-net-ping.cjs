const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/useNetworkStore.js');
let code = fs.readFileSync(filePath, 'utf-8');

// 1. Update the Host Ping Loop
const oldPing = `        // Ping interval
      const pingInterval = setInterval(() => {
         get().connections.forEach(conn => {
            try { conn.send({ type: 'PING', time: Date.now() }); } catch(e) {}
         });
      }, 5000);
      set({ pingInterval });`;

const newPing = `        // Phase 7: WebRTC Keep-Alive (Ping/Pong)
      const pingInterval = setInterval(() => {
         const now = Date.now();
         get().connections.forEach(conn => {
            // Check Cull Timeout (30s)
            if (conn._lastPongTime && (now - conn._lastPongTime > 30000)) {
                console.warn(\`[WebRTC] Cull Timeout for \${conn.peer}\`);
                conn.close();
                get().removePlayer(conn.peer);
                // Also close unreliable channel
                get().unreliableConnections.forEach(uc => {
                    if (uc.peer === conn.peer) uc.close();
                });
                return;
            }
            try { 
                conn.send({ type: 'HEARTBEAT_PING', time: now }); 
                // Initialize if not set
                if (!conn._lastPongTime) conn._lastPongTime = now;
            } catch(e) {}
         });
      }, 10000); // 10s PING
      set({ pingInterval });`;

code = code.replace(oldPing, newPing);

// 2. Add Network Data Handler for Ping/Pong
const dataHandlerRegex = /else if \(data\.type === 'PING'\) \{\n\s*const rtt = Date\.now\(\) - data\.time;\n\s*if \(window\.__DEBUG_STATS__\) window\.__DEBUG_STATS__\.ping = rtt;\n\s*\}/m;

const newDataHandler = `else if (data.type === 'PING') {
           const rtt = Date.now() - data.time;
           if (window.__DEBUG_STATS__) window.__DEBUG_STATS__.ping = rtt;
        }
        else if (data.type === 'HEARTBEAT_PING') {
           // Guest replies to Host
           const peerConn = get().connections[0];
           if (peerConn) {
              try { peerConn.send({ type: 'HEARTBEAT_PONG' }); } catch(e) {}
           }
        }
        else if (data.type === 'HEARTBEAT_PONG') {
           // Host receives reply from Guest
           if (senderConn) {
               senderConn._lastPongTime = Date.now();
           }
        }`;

code = code.replace(dataHandlerRegex, newDataHandler);

fs.writeFileSync(filePath, code);
console.log('useNetworkStore patched with Keep-Alive!');
