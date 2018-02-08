/**
 * Back in the day, it was enough to just concatenate scripts together. That approach had problems:
 * scripts had to be concatenated in the correct order, advanced techniques like hot module
 * replacement or tree shaking required better understanding of the project.
 *
 * Module bundlers take a different approach, they treat your project as a dependency graph.
 *
 * Our module bundler will processes our application: it will start from an entry file, this file
 * is the root of our application. It will recursively builds a dependency graph that includes every
 * module our application needs, and finally it will package all of those modules into just one
 * bundle to be loaded by the browser.
 */

/**
 * Please note: this is an ultra-simplified example. Error handling or handling edge cases like
 * circular dependencies, caching module exports, parsing each module just once or others are
 * skipped to make this example as simple as possible.
 */

const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const { transformFromAst } = require('babel-core');
const { resolveFrom } = require('./utils');

let id = 0;

// We start by defining a recursive function to create our dependency graph. This graph will be
// represented as an object with a files absolute paths as keys and an object with that file's data
// as its values.
function createDependencyGraph(filename) {
  // We start by reading the file's content as a string
  const content = fs.readFileSync(filename, 'utf-8');

  // We then parse it with a JavaScript parser (see https://astexplorer.net) and generate an AST.
  const ast = babylon.parse(content, {
    sourceType: 'module',
  });

  // This array will hold the relative paths of modules this module depends on.
  const dependencies = [];

  // We traverse the AST to try and understand which modules this module depends on.
  traverse(ast, {
    // ES6 modules are fairly easy because they are static. This means that you can't import a
    // variable, or conditionaly import another module. Every time we see an import statement we
    // can just count it as a dependency.
    ImportDeclaration({ node }) {
      dependencies.push(node.source.value);
    },
    // Covering require calls is a bit trickier: We'll go over every function call in this file,
    // if its name is 'require', and its only argument is a string then we'll count it in as
    // a dependency. It won't cover all the cases, but it's good enough.
    //
    // Tools like Webpack can actually handle some pretty rough cases, see: https://webpack.js.org/guides/dependency-management
    CallExpression({ node }) {
      const isRequire = node.callee.name === 'require' &&
        node.arguments.length === 1 &&
        node.arguments[0].type === 'StringLiteral';

      if (isRequire) {
        dependencies.push(node.arguments[0].value);
      }
    },
  });

  // We define an object indexed by our file's absolute path that contains all of the information we
  // have about our file.
  const initial = {
    [filename]: {
      // We define an id to have a shorter identifier to a file other than its absolute file path.
      id: id++,
      ast,
      content,
      // We represent this module's list of dependencies as an object with relative paths as keys
      // and absolute paths as values
      dependencies: dependencies.reduce((acc, relativeFilename) => {
        const fullFilename = resolveFrom(path.dirname(filename), relativeFilename);

        return {
          ...acc,
          [relativeFilename]: fullFilename,
        };
      }, {}),
    },
  };

  // We iterate over all of this module's dependencies and extract their dependencies, merging it
  // all into one big object which we return.
  return Object.values(initial[filename].dependencies)
    .reduce((acc, fullFilename) => {
      const result = createDependencyGraph(fullFilename);

      return {
        ...acc,
        ...result,
      };
    }, initial);
}

// This is the main function we export: it takes an entry point and return our bundled application
// as one large string. That string can later be saved as a JavaScript file.
module.exports = (entry) => {
  // We start by creating our graph. Remember, this is just a flat object with its keys being
  // absolute file paths and its values are objects with data on those modules.
  const graph = createDependencyGraph(entry);

  // We used import and export statements and other features that may not be supported in all
  // web browsers.
  //
  // To make sure our bundle runs in a browser we will transpile it with Babel (see https://babeljs.io)
  //
  // We iterate on all the objects in our graph, transpile their code to EcmaScript 5 and mutate
  // them by adding a new 'code' property to them. It will hold the value of their transpiled code
  // as a string.
  Object.values(graph).forEach((asset) => {
    // We use transformFromAst instead of the regular transform to save computing power and make
    // bundling faster.
    const { code } = transformFromAst(asset.ast, asset.content, {
      presets: ['es2015'],
    });

    // We add our result as a new property.
    asset.code = code;
  });

  /**
   * We're done creating our dependency graph and going over it to transpile each module with Babel.
   * Now we're going to package it all into one bundle.
   *
   * The bundle should contain each module in our graph within its own scope. That means that
   * defining a variable in one module shouldn't affect others in the bundle.
   *
   * Our transpiled module modules use the commonjs module system: they expect a global require
   * function to be available along with a global module and an exports objects. Those functions
   * and objects are not normally available in a browser, so we'll have to implement them in our
   * bundle.
   *
   * Our bundle will contain one self invoking function that will accept one argument: an object
   * with data about our modules. It should have module IDs as keys and a tuple (an array with two
   * values) for values.
   *
   * The first value in the array will be a function to wrap the code of that module to create a
   * scope for it. It will also accept a require function, a module object and an exports object
   * that our module expects to be available globally.
   *
   * Our function will then create an implementation of the require function and require the entry
   * module to fire up the application.
   */

  // We start by defining the object to be fed to our self invoking function.
  let modules = '';

  // We iterate the graph
  Object.values(graph).forEach((mod) => {
    // The second value in the array is an a mapping object. This object will contain the relative
    // path of every module this module depends on and its absolute ID as a value.
    //
    // In our implementation of the require function we'll need to resolve relative module paths
    // for every one of our modules.
    const mapping = Object.keys(mod.dependencies).reduce((acc, relativeFilename) => {
      const fullFilename = mod.dependencies[relativeFilename];

      return {
        ...acc,
        [relativeFilename]: graph[fullFilename].id,
      };
    }, {});

    // For every module in the graph we create a new index in our object: an array containing
    // the wrapping function for our module code and its mappings object.
    modules += `
      ${mod.id}: [
        function (require, module, exports) { ${mod.code} },
        ${JSON.stringify(mapping)}
      ],`;
  });

  /**
   * We create a simple implementation of the require function: it accepts a module ID and looks for
   * it in the modules object. Our modules expect their require function to take a relative path to
   * a module instead of an ID. Also, that relative path should be relative to the requiring module,
   * which may be different for each module.
   *
   * To handle that, whenever a module is being required we will create a new require function,
   * namely localRequire to map the relative module paths to module IDs using our previous mapping.
   *
   * We feed the wrapping module function its own localRequire, along with a module.exports object
   * for it to mutate, and eventually return it.
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

  // We simply return the result, you made it! :)
  return bundle;
};
