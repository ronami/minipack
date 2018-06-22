/**
 * Module bundlers compile small pieces of code into something larger and more
 * complex that can run in a web browser. These small pieces are just JavaScript
 * files, and dependencies between them are expressed by a module system
 * (https://webpack.js.org/concepts/modules).
 *
 * Module bundlers have this concept of an entry file. Instead of adding a few
 * script tags in the browser and letting them run, we let the bundler know
 * which file is the main file of our application. This is the file that should
 * bootstrap our entire application.
 *
 * Our bundler will start from that entry file, and it will try to understand
 * which files it depends on. Then, it will try to understand which files its
 * dependencies depend on. It will keep doing that until it figures out about
 * every module in our application, and how they depend on one another.
 *
 * This understanding of a project is called the dependency graph.
 *
 * In this example, we will create a dependency graph and use it to package
 * all of its modules in one bundle.
 *
 * Let's begin :)
 *
 * Please note: This is a very simplified example. Handling cases such as
 * circular dependencies, caching module exports, parsing each module just once
 * and others are skipped to make this example as simple as possible.
 */

const fs = require('fs');
const path = require('path');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const {transformFromAst} = require('babel-core');

let ID = 0;

// We start by creating a function that will accept a path to a file, read
// its contents, and extract its dependencies.
function createAsset(filename) {
  // Read the content of the file as a string.
  const content = fs.readFileSync(filename, 'utf-8');

  // Now we try to figure out which files this file depends on. We can do that
  // by looking at its content for import strings. However, this is a pretty
  // clunky approach, so instead, we will use a JavaScript parser.
  //
  // JavaScript parsers are tools that can read and understand JavaScript code.
  // They generate a more abstract model called an AST (abstract syntax tree).

  // I strongly suggest that you look at AST Explorer (https://astexplorer.net)
  // to see how an AST looks like.
  //
  // The AST contains a lot of information about our code. We can query it to
  // understand what our code is trying to do.
  const ast = babylon.parse(content, {
    sourceType: 'module',
  });

  // This array will hold the relative paths of modules this module depends on.
  const dependencies = [];

  // We traverse the AST to try and understand which modules this module depends
  // on. To do that, we check every import declaration in the AST.
  traverse(ast, {
    // EcmaScript modules are fairly easy because they are static. This means
    // that you can't import a variable, or conditionally import another module.
    // Every time we see an import statement we can just count its value as a
    // dependency.
    ImportDeclaration: ({node}) => {
      // We push the value that we import into the dependencies array.
      dependencies.push(node.source.value);
    },
  });

  // We also assign a unique identifier to this module by incrementing a simple
  // counter.
  const id = ID++;

  // We use EcmaScript modules and other JavaScript features that may not be
  // supported on all browsers. To make sure our bundle runs in all browsers we
  // will transpile it with Babel (see https://babeljs.io).
  //
  // The `presets` option is a set of rules that tell Babel how to transpile
  // our code. We use `babel-preset-env` to transpile our code to something
  // that most browsers can run.
  const {code} = transformFromAst(ast, null, {
    presets: ['env'],
  });

  // Return all information about this module.
  return {
    id,
    filename,
    dependencies,
    code,
  };
}

// Now that we can extract the dependencies of a single module, we are going to
// start by extracting the dependencies of the entry file.
//
// Then, we are going to extract the dependencies of every one of its
// dependencies. We will keep that going until we figure out about every module
// in the application and how they depend on one another. This understanding of
// a project is called the dependency graph.
function createGraph(entry) {
  // Start by parsing the entry file.
  const mainAsset = createAsset(entry);

  // We're going to use a queue to parse the dependencies of every asset. To do
  // that we are defining an array with just the entry asset.
  const queue = [mainAsset];

  // We use a `for ... of` loop to iterate over the queue. Initially the queue
  // only has one asset but as we iterate it we will push additional new assets
  // into the queue. This loop will terminate when the queue is empty.
  for (const asset of queue) {
    // Every one of our assets has a list of relative paths to the modules it
    // depends on. We are going to iterate over them, parse them with our
    // `createAsset()` function, and track the dependencies this module has in
    // this object.
    asset.mapping = {};

    // This is the directory this module is in.
    const dirname = path.dirname(asset.filename);

    // We iterate over the list of relative paths to its dependencies.
    asset.dependencies.forEach(relativePath => {
      // Our `createAsset()` function expects an absolute filename. The
      // dependencies array is an array of relative paths. These paths are
      // relative to the file that imported them. We can turn the relative path
      // into an absolute one by joining it with the path to the directory of
      // the parent asset.
      const absolutePath = path.join(dirname, relativePath);

      // Parse the asset, read its content, and extract its dependencies.
      const child = createAsset(absolutePath);

      // It's essential for us to know that `asset` depends on `child`. We
      // express that relationship by adding a new property to the `mapping`
      // object with the id of the child.
      asset.mapping[relativePath] = child.id;

      // Finally, we push the child asset into the queue so its dependencies
      // will also be iterated over and parsed.
      queue.push(child);
    });
  }

  // At this point the queue is just an array with every module in the target
  // application: This is how we represent our graph.
  return queue;
}

// Next, we define a function that will use our graph and return a bundle that
// we can run in the browser.
//
// Our bundle will have just one self-invoking function:
//
// (function() {})()
//
// That function will receive just one parameter: An object with information
// about every module in our graph.
function bundle(graph) {
  let modules = '';

  // Before we get to the body of that function, we'll construct the object that
  // we'll pass to it as a parameter. Please note that this string that we're
  // building gets wrapped by two curly braces ({}) so for every module, we add
  // a string of this format: `key: value,`.
  graph.forEach(mod => {
    // Every module in the graph has an entry in this object. We use the
    // module's id as the key and an array for the value (we have 2 values for
    // every module).
    //
    // The first value is the code of each module wrapped with a function. This
    // is because modules should be scoped: Defining a variable in one module
    // shouldn't affect others or the global scope.
    //
    // Our modules, after we transpiled them, use the CommonJS module system:
    // They expect a `require`, a `module` and an `exports` objects to be
    // available. Those are not normally available in the browser so we'll
    // implement them and inject them into our function wrappers.
    //
    // For the second value, we stringify the mapping between a module and its
    // dependencies. This is an object that looks like this:
    // { './relative/path': 1 }.
    //
    // This is because the transpiled code of our modules has calls to
    // `require()` with relative paths. When this function is called, we should
    // be able to know which module in the graph corresponds to that relative
    // path for this module.
    modules += `${mod.id}: [
      function (require, module, exports) {
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)},
    ],`;
  });

  // Finally, we implement the body of the self-invoking function.
  //
  // We start by creating a `require()` function: It accepts a module id and
  // looks for it in the `modules` object we constructed previously. We
  // destructure over the two-value array to get our function wrapper and the
  // mapping object.
  //
  // The code of our modules has calls to `require()` with relative file paths
  // instead of module ids. Our require function expects module ids. Also, two
  // modules might `require()` the same relative path but mean two different
  // modules.
  //
  // To handle that, when a module is required we create a new, dedicated
  // `require` function for it to use. It will be specific to that module and
  // will know to turn its relative paths into ids by using the module's
  // mapping object. The mapping object is exactly that, a mapping between
  // relative paths and module ids for that specific module.
  //
  // Lastly, with CommonJs, when a module is required, it can expose values by
  // mutating its `exports` object. The `exports` object, after it has been
  // changed by the module's code, is returned from the `require()` function.
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

const graph = createGraph('./example/entry.js');
const result = bundle(graph);

console.log(result);
