# script-linker

CJS/MJS source loader that can preresolve imports/requires so linking them on runtime runs much faster.

Features include:

* Simple transforms (ie all contained on the same line)
* Source Maps for all transforms so debugging code is easy
* IO agnostic, bring your own IO
* Similar CJS/ESM interop like Node.js
* Cross platform

## Usage

``` js
const ScriptLinker = require('script-linker')

const s = new ScriptLinker({
  builtins: {
    has (path) {
      // return true if builtin, false otherwise
    },
    get (path) {
      // return the builtin module for that path
    },
    keys () {
      // return the list of builtin modules
    }
  },
  map (path, { isImport, isBuiltin, isSourceMap, isConsole }) {
    // return a url that is actually passed to import/getSync
    // a default method is provided (see ./lib/defaults.js)
  },
  mapImport (id, dirname) {
    // rewrite an import if you want to.
    // runs BEFORE resolve on all imports, including custom scheme ones
    // dirname is directory the import is coming from for conveinience
    return id
  },
  readFile (name) {
    return fs.promises...
  },
  stat (name) { // optional call to be used if you cache module resolutions somewhere
    return {
      type: module.type,
      resolutions: module.resolutions
    }
  }
})

const module = await s.load('/some/module.js')

console.log(module.type) // module/json/commonjs
console.log(module.resolutions) // the resolved modules
console.log(module.source) // original source
console.log(module.toESM()) // transform to esm with imports preresolved
console.log(module.toCJS()) // transform to cjs with requires preresolved
console.log(module.geneateSourceMap()) // generate a source map
```

In the process executing the module, you need to include the ScriptLinker runtime dep.
Currently that's done by running

```js
// Run this in the render/module process.
// Sets up a global object, global[Symbol.for('scriptlinker')], that is used to make modules run.
// Has no nodejs/native deps so can be browserified if preferred.

ScriptLinker.preload({
  builtins, // same as above
  map, // same as above
  getSync (url) {
    // resolve this url synchronously (ie xhr sync or equi)
    // the url is ALWAYS a url returned from map so you should know
    // how to resolve the url and return the relevant content, ie cjs/esm/sourcemap string
  },
  resolveSync (req, dirname, { isImport }) {
    // resolve the import/require request ie "./foo.js" or "fs"
    // from the directory passed. isImport indicates if this is a require or import() call.
    // should return the absolute path to the module.
  }
})
```
