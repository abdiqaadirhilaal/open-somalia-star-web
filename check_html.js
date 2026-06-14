const fs = require('fs');
const html = fs.readFileSync('manager/index.html', 'utf8');

const scriptOpen = html.match(/<script[^>]*>/g);
const scriptClose = html.match(/<\/script\s*>/g);
console.log('Script open tags:', scriptOpen ? scriptOpen.length : 0);
console.log('Script close tags:', scriptClose ? scriptClose.length : 0);
console.log('Match:', scriptOpen && scriptClose && scriptOpen.length === scriptClose.length ? 'OK' : 'MISMATCH!');

const sections = html.match(/id="section-/g);
console.log('Sections:', sections ? sections.length : 0);

const bodyClose = html.match(/<\/body\s*>/g);
console.log('Body close:', bodyClose ? bodyClose.length : 0);

const htmlClose = html.match(/<\/html\s*>/g);
console.log('HTML close:', htmlClose ? htmlClose.length : 0);

// Check braces balance in JS
const scriptBlocks = [];
const regex = /<script[^>]*>([\s\S]*?)<\/script\s*>/g;
let m;
while ((m = regex.exec(html)) !== null) {
  scriptBlocks.push(m[1]);
}
console.log('Script blocks:', scriptBlocks.length);

const allJS = scriptBlocks.join('\n');
const opens = (allJS.match(/\{/g) || []).length;
const closes = (allJS.match(/\}/g) || []).length;
console.log('JS braces - open:', opens, 'close:', closes, opens === closes ? 'OK' : 'MISMATCH!');
console.log('Total lines:', html.split('\n').length);
