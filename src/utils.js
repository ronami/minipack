const path = require('path');

module.exports.resolveFrom = (context, filename) => {
  return require.resolve(path.resolve(context, filename));
};
