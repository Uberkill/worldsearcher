const fs = require('fs');
const puppeteer = require('puppeteer');

// Check the average color of screenshot.png using Jimp or Canvas? We don't have them easily.
// Instead we can look at the file size.
const stats = fs.statSync('screenshot.png');
console.log('Screenshot file size (bytes):', stats.size);
