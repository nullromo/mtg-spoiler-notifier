import fs from 'fs';

console.log('hello from typescript');

fs.writeFileSync(
    'results.txt',
    `test results content at ${new Date().toLocaleString()}`,
);
