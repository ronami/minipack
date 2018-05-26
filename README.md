## 📦 Minipack

> A simplified example of a modern module bundler written in JavaScript

### Introduction

As front-end developers we spend a lot of time working with tools like [Webpack](https://github.com/webpack/webpack) or [Browserify](https://github.com/browserify/browserify).

Understanding how those tools work internally can help us make better decisions on how we write our code.

The purpose of this project is to explain how most bundlers work. It contains a short implementation of a simplified but still reasonably accurate bundler. Along with the code there are comments explaining what the code is trying to achieve.

### Try running the code

Start by installing dependencies:

```sh
$ npm install
```

And then run our script:

```sh
$ node src/minipack.js
```

### Cool, where do I start?

Head on to the source code: [src/minipack.js](src/minipack.js).

### Additional links

- [AST Explorer](https://astexplorer.net/)
- [Babel REPL](https://babeljs.io/repl/)
- [Babylon](https://github.com/babel/babel/tree/master/packages/babel-parser)
- [Babel Plugin Handbook](https://github.com/thejameskyle/babel-handbook/blob/master/translations/en/plugin-handbook.md)
- [Webpack: dependency managment](https://webpack.js.org/guides/dependency-management)
