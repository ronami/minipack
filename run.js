const minipack = require('./src/minipack');

const entry = require.resolve('./example/entry');
const result = minipack(entry);

console.log(result);
