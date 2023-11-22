import fs from 'fs';

// print debug message
console.log('hello from typescript');

// get results from previous run
const lastResults = fs.readFileSync('last-results.txt').toString();

// create results for this run
const results = `test results content at ${new Date().toLocaleString()}`;

// print debug message
console.log('last results were', lastResults);
console.log('new results are', results);

// save results for this run
fs.writeFileSync('results.txt', results);
