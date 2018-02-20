/**
 * Module bundlers bundle many files to be used in a web-browser. Node.js has supported modular
 * programming for a long time. On the web, however, we need tools like module bundlers to support
 * it.
 *
 * Our module bundler will processes our application statically: it will start from an entry file,
 * this file is the root of our application. It will recursively build a dependency graph that includes
 * every module our application needs. Finally, it will package all of those modules into just one
 * bundle to be loaded by the browser.
 *
 * This is an ultra-simplified example. Handling cases such as circular dependencies, caching module
 * exports, parsing each module just once and others are skipped to make this example as simple as
 * possible.
 *
 * Let's begin :)
 */

const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const {transformFromAst} = require('babel-core');
const {resolveFrom} = require('./utils');

let id = 0;

// We start by defining a recursive function to create our dependency graph. This graph will be represented
// as an object with file's absolute paths as keys and an object with that file's data as its values.
// Here's a rough example:
// {
//   '/some/folder/file.js': { ... }
// }
function createDependencyGraph(filename) {
  // We start by reading the file's content as a string.
  const content = fs.readFileSync(filename, 'utf-8');

  // We then parse it with a JavaScript parser (see https://astexplorer.net) to generate an AST.
  const ast = babylon.parse(content, {
    sourceType: 'module',
  });

  // This array will hold the relative paths of modules this module depends on.
  const dependencies = [];

  // We traverse the AST to try and understand which modules this module depends on.
  // To do that, we check every import declaration and every function call that looks like a call
  // to 'require()'.
  traverse(ast, {
    // ES6 modules are fairly easy because they are static. This means that you can't import a variable,
    // or conditionaly import another module. Every time we see an import statement we can just count its
    // value as a dependency.
    ImportDeclaration({node}) {
      dependencies.push(node.source.value);
    },
    // Covering require calls is a bit trickier: we go over every function call in the tree, if the name
    // of the function being called is 'require' and its only argument is a string then it fits. We then
    // count it in as a dependency.
    //
    // Tools like Webpack can actually handle some pretty rough cases, see: https://webpack.js.org/guides/dependency-management
    CallExpression({node}) {
      const isRequire =
        node.callee.name === 'require' &&
        node.arguments.length === 1 &&
        node.arguments[0].type === 'StringLiteral';

      if (isRequire) {
        dependencies.push(node.arguments[0].value);
      }
    },
  });

  // We define an object indexed by the file's absolute path with all of the information we have about
  // our file.
  const initial = {
    [filename]: {
      // We define an id to have a shorter identifier for this file other than its absolute file path.
      id: id++,
      ast,
      content,
      // We represent this module's dependencies as an object with relative paths as keys and absolute
      // paths as values, it will look like this:
      // {
      //   './relative/path/to/dependency': '/absolute/path/to/dependency'
      // }
      dependencies: dependencies.reduce((acc, relativeFilename) => {
        const fullFilename = resolveFrom(
          path.dirname(filename),
          relativeFilename,
        );

        return {
          ...acc,
          [relativeFilename]: fullFilename,
        };
      }, {}),
    },
  };

  // We iterate over all of this module's dependencies and extract their dependencies recursively, merging
  // all results into one big object which we return. Try printing it to see how our model looks like!
  return Object.values(initial[filename].dependencies).reduce(
    (acc, fullFilename) => {
      const result = createDependencyGraph(fullFilename);

      return {
        ...acc,
        ...result,
      };
    },
    initial,
  );
}

// This is the main function we export: it takes an entry point and return our bundled application as one
// big string. That string can later be saved as a JavaScript file.
module.exports = entry => {
  // We start by creating our graph. Remember, this is just a flat object with its keys being absolute file
  // paths and its values are objects with data on those modules.
  const graph = createDependencyGraph(entry);

  // We use ES6 modules and other JavaScript features that may not be supported on all browsers. To make
  // sure our bundle runs in all browsers we will transpile it with Babel (see https://babeljs.io)
  //
  // We iterate on all of the objects in our graph, transpile their code to ES5 and mutate them by adding
  // a new 'code' property to them. It will hold the value of their transpiled code as a string.
  Object.values(graph).forEach(asset => {
    // We use transformFromAst() instead of the regular transform to save computing power and make bundling
    // faster.
    const {code} = transformFromAst(asset.ast, asset.content, {
      presets: ['es2015'],
    });

    // We add our result as a new property.
    asset.code = code;
  });

  /**
   * We're done creating our dependency graph and going over it to transpile each module with Babel. Now we're
   * going to package it all into one bundle.
   *
   * That bundle should include each module in our graph within its own scope. This means, for instance, that
   * defining a variable in one module shouldn't affect others in the bundle.
   *
   * Our transpiled modules use the CommonJS module system: they expect a function called 'require' to be
   * available globally, along with a 'module' and an 'exports' objects. Those variables are not normally
   * available in a browser, so we'll have to implement them.
   *
   * Our bundle, in essense, will have one self invoking function. Something like this:
   *
   * (function() {})()
   *
   * I will accept just one argument: an object with data about our modules. That object will have module
   * IDs as keys and a tuple (an array with two values) for values.
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
   * The first value in the array will be a function to wrap the code of that module to create a
   * scope for it. It will also accept a require function, a module object and an exports object
   * that our module expects to be available globally.
   *
   * Here's another part of the comics:
   *
   * (function(modules) {
   *   ...
   * })({
   *   0: [function (require, module, exports) { const message = require('./message') }, { './message': 1 }],
   *   1: [function (require, module, exports) { const {name} = require('./name') }, { './name': 2 }],
   * })
   *
   * Our function will then create an implementation of the require function and require the entry
   * module to fire up the application.
   *
   * Here's a rough look of it:
   *
   * (function(modules) {
   *   function require() {}
   *
   *   require(0);
   * })({
   *   0: [function (require, module, exports) { const message = require('./message') }, { './message': 1 }],
   *   1: [function (require, module, exports) { const {name} = require('./name') }, { './name': 2 }],
   * })
   *
   * Let's give it a go, huh?
   */

  // We start by defining the object to be fed to our self invoking function.
  let modules = '';

  // We iterate the graph
  Object.values(graph).forEach(mod => {
    // The second value in the array is a mapping object. It will have relative paths of every module this
    // module depends on as keys and its absolute ID as a value.
    //
    // We'll need this soon when we implement the 'require' function to resolve relative with absolute module IDs.
    const mapping = Object.keys(mod.dependencies).reduce(
      (acc, relativeFilename) => {
        const fullFilename = mod.dependencies[relativeFilename];

        return {
          ...acc,
          [relativeFilename]: graph[fullFilename].id,
        };
      },
      {},
    );

    // Every module in the graph will be show up here with its ID as key and an array with the function wrapping
    // our module code and its mappings object.
    modules += `
      ${mod.id}: [
        function (require, module, exports) { ${mod.code} },
        ${JSON.stringify(mapping)}
      ],`;
  });

  /**
   * Time to create a simple implementation of the require function: it accepts a module ID and looks for
   * it in the modules object. Our modules expect the 'require' function to take a relative path to a module
   * instead of an ID. When I say relative I mean relative to that module. Those paths can be different between
   * modules.
   *
   * To handle that, when a module is required we will create a new, dedicated require function for it to use.
   * It will be specific to it and will know to resolve all of its relative paths. We feed the wrapping module
   * function its own localRequire, along with a module.exports object for it to mutate and then return it.
   */
  const bundle = `
    (function(modules) {
      function require(id) {
        const [module, mapping] = modules[id];

        function localRequire(name) {
          return require(mapping[name]);
        }

        const localModule = { exports: {} };

        module(localRequire, localModule, localModule.exports);

        return localModule.exports;
      }

      require(0);
    })({${modules}})
  `;

  // We simply return the result, hurray! you made it! :)
  return bundle;
};
