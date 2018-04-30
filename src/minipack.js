/**
 * Developing software can be significantly easier if you break your project
 * into smaller separate pieces. Node.js has supported it for a long time,
 * however, on the web, we need tools like Webpack or Rollup to support it.
 *
 * Module bundlers compile small pieces of code into something larger and more
 * complex that can run in a web-browser. These small pieces are just JavaScript
 * files and dependencies between them are expressed via a module system
 * (https://webpack.js.org/concepts/modules).
 *
 * Our module bundler will processes our application statically: it will start
 * from an entry file, this file is the root of our application. It will
 * recursively build a dependency graph that includes every module our
 * application needs. Finally, it will package all of those modules into just
 * one bundle to be loaded by the browser.
 *
 * This is an ultra-simplified example. Handling cases such as circular
 * dependencies, caching module exports, parsing each module just once and
 * others are skipped to make this example as simple as possible.
 *
 * Let's begin :)
 */

const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const {transformFromAst} = require('babel-core');

let ID = 0;

/**
 * We start by defining a function to parse a single file in an application.
 * It should read and analyze the content of the file and extract information
 * about it.
 */
function parseAsset(filename) {
  // We start by reading the content of the file as a string.
  const content = fs.readFileSync(filename, 'utf-8');

  // We then parse it with a JavaScript parser (see https://astexplorer.net) to
  // generate an AST.
  const ast = babylon.parse(content, {
    sourceType: 'module',
  });

  // We also assign a unique identifier to this module.
  const id = ID++;

  // This array will hold the relative paths of modules this module depends on.
  const dependencies = [];

  // We traverse the AST to try and understand which modules this module depends
  // on. To do that, we check every import declaration in this file's AST.
  traverse(ast, {
    // ES6 modules are fairly easy because they are static. This means that you
    // can't import a variable, or conditionally import another module. Every
    // time we see an import statement we can just count its value as a
    // dependency.
    ImportDeclaration: ({node}) => {
      dependencies.push(node.source.value);
    },
  });

  // We use ES6 modules and other JavaScript features that may not be supported
  // on all browsers. To make sure our bundle runs in all browsers we will
  // transpile it with Babel (see https://babeljs.io).
  const {code} = transformFromAst(ast, null, {
    presets: ['env'],
  });

  // Eventually return all information about this module as a plain object.
  return {
    id,
    filename,
    dependencies,
    code,
  };
}

/*
 * Now that we can parse a single module, we can use that to parse the entire
 * project.
 */
function createGraph(entry) {
  // We start by parsing the entire file.
  const mainAsset = parseAsset(entry);

  // We're going to use a queue to parse the dependencies of every asset. To do
  // that we are defining an array with just the entry asset.
  const queue = [mainAsset];

  // Whenever we're done processing an asset we will push it to this array. It
  // keeps track of every asset we already finished processing.
  const processedAssets = [];

  // We use a `for ... of` loop to iterate over the queue. Initially the queue only
  // has one asset but as we iterate it we will push additional assets into the
  // queue. This loop will terminate when the queue is empty.
  for (const asset of queue) {
    // Currently every one of our assets has a list of relative paths to the modules
    // it dependes on.
    asset.mapping = {};

    // This is the directory this module is in.
    const dirname = path.dirname(asset.filename);

    // We iterate over the list of relative paths to its dependencies.
    asset.dependencies.forEach(relativePath => {
      // We resolve the relative path based on the directory of the asset into an
      // absolute path.
      const absolutePath = path.join(dirname, relativePath);

      // We then parse the asset, reading its content and extracting its dependencies.
      const child = parseAsset(absolutePath);

      // We add a reference to the parent asset by the relative path to the dependency
      // to the identifier of the newly created asset.
      asset.mapping[relativePath] = child.id;

      // And we push the child into the queue so its dependencies will also be iterated
      // and parsed.
      queue.push(child);
    });

    // Once we're done parsing its depencies, we push it to the list of 'finished' modules.
    processedAssets.push(asset);
  }

  // Return the list of modules.
  return processedAssets;
}

/**
 * Now we're defining a function that will take our list of modules and package
 * them into one bundle.
 *
 * Our bundle should include each module in our graph within its own scope.
 * This means, for instance, that defining a variable in one module shouldn't
 * affect others in the bundle.
 *
 * Our transpiled modules use the CommonJS module system: they expect a
 * function called 'require' to be available globally, along with a 'module'
 * and an 'exports' objects. Those variables are not normally available in a
 * browser, so we'll have to implement them.
 *
 * Our bundle, in essence, will have one self-invoking function. Something
 * like this:
 *
 * (function() {})()
 *
 * I will accept just one argument: an object with data about our modules.
 * That object will have module IDs as keys and a tuple (an array with two
 * values) for values.
 *
 * Here's is it again:
 *
 * (function(modules) {
 *   ...
 * })({
 *   0: [],
 *   1: [],
 * })
 *
 * The first value in the array will be a function to wrap the code of that
 * module to create a scope for it. It will also accept a require function, a
 * module object and an exports object that our module expects to be available
 * globally.
 *
 * Here's another part of the comics:
 *
 * (function(modules) {
 *   ...
 * })({
 *   0: [
 *      function (require, module, exports) {
 *        const message = require('./message');
 *        ...
 *      },
 *      { './message': 1 },
 *    ],
 *   1: [
 *      function (require, module, exports) {
 *        const {name} = require('./name');
 *        ...
 *      },
 *      { './name': 2 },
 *    ],
 * })
 *
 * Our function will then create an implementation of the require function and
 * require the entry module to fire up the application.
 *
 * Here's a rough look at it:
 *
 * (function(modules) {
 *   function require() { ... }
 *
 *   require(0);
 * })({
 *   0: [
 *      function (require, module, exports) {
 *        const message = require('./message');
 *        ...
 *      },
 *      { './message': 1 },
 *   ],
 *   1: [
 *      function (require, module, exports) {
 *        const {name} = require('./name');
 *        ...
 *      },
 *      { './name': 2 },
 *   ],
 * })
 *
 * Let's give it a go, huh?
 */
function bundle(processedAssets) {
  // Every module in the graph will show up here with its ID as the key and an
  // array with the function wrapping our module code and its mappings
  // object.
  const modules = processedAssets.reduce((acc, mod) => {
    return `${acc}${mod.id}: [
      function (require, module, exports) { ${mod.code} },
      ${JSON.stringify(mod.mapping)},
    ],`;
  }, '');

  /**
   * Time to create a simple implementation of the require function: it accepts
   * a module ID and looks for it in the modules object. Our modules expect the
   * 'require' function to take a relative path to a module instead of an ID.
   * When I say relative I mean relative to that module. Those paths can be
   * different between modules.
   *
   * To handle that, when a module is required we will create a new, dedicated
   * require function for it to use. It will be specific to it and will know to
   * resolve all of its relative paths. We feed the wrapping module function its
   * own localRequire, along with a module.exports object for it to mutate and
   * then return it.
   */
  const result = `
    (function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id];

        function localRequire(name) {
          return require(mapping[name]);
        }

        const module = { exports : {} };

        fn(localRequire, module, module.exports);

        return module.exports;
      }

      require(0);
    })({${modules}})
  `;

  // We simply return the result, hurray! :)
  return result;
}

const graph = createGraph('/Users/ronena/Projects/minipack/example/entry.js');
const result = bundle(graph);

console.log(result);
