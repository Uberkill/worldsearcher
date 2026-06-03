const fs = require('fs');

const html = fs.readFileSync('dom.html', 'utf-8');

// Check for Canvas element
const canvasIdx = html.indexOf('<canvas');
if (canvasIdx !== -1) {
    const canvasEnd = html.indexOf('>', canvasIdx);
    console.log('Canvas element:', html.substring(canvasIdx, canvasEnd + 1));
} else {
    console.log('NO CANVAS ELEMENT FOUND');
}

// Check for ErrorBoundary fallback
if (html.includes('Something went wrong')) {
    console.log('ErrorBoundary triggered!');
}

// Check for anything inside the body
const bodyIdx = html.indexOf('<body');
if (bodyIdx !== -1) {
    const rootIdx = html.indexOf('<div id="root"');
    const rootEnd = html.indexOf('</div>', rootIdx);
    console.log('Root element contains:', html.substring(rootIdx, rootIdx + 100) + '...');
}
