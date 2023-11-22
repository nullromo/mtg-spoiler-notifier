import fs from 'fs';

console.log('hello from typescript');

const lastResults = fs.readFileSync('last-results.txt');
const results = `test results content at ${new Date().toLocaleString()}`;

console.log('last results were', lastResults);
console.log('new results are', results);

fs.writeFileSync('results.txt', results);
