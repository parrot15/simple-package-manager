# Simple Package Manager

**Author:** Eashan Soni

## Introduction

This is a simplified package manager written in Typescript. It includes features such as:

- **Deterministic installation** — Implements a lock file `package-lock.json`.
- **Package validation** — Computes a SHA512 hash and compares this with the expected hash from the NPM registry.
- **Caching** — When downloading the dependencies, caches the tarballs into a folder `output/.cache`. Also, during execution, caches network requests for metadata and version info using an in-memory LRU (Least-Recently Used) cache.
- **Dependency conflict resolution** — Follows a simple strategy. If two dependencies require different versions of another dependency, includes both versions of that dependency. For example, if `package.json` specifies a package `semver` which resolves to version `7.6.2`, but another package depends on a version `7.5.2`, both `semver@7.6.2` and `semver@7.5.2` will be included in the dependency graph (lock file).
- **Circular dependency avoidance** — When installing packages, recursively installs all of the sub-dependencies of a given package first before installing the package itself, following a topological sort pattern. Additionally, marks packages as installed. So if a package has already been installed, it is skipped.
- **Automatic detection of dependency changes** — If any differences are detected between the resolved versions of the packages in `package.json` and the locked versions in the lock file, the package manager will automatically know to update the packages, lock file, and caches. This follows a simple strategy of merely rebuilding the entire dependency graph when a change is detected.

All output of the package manager is written to the `output` directory. Within this directory are the files `package.example.json`, `package-lock.example.json`, and `output.example.txt`. These are example files for the package.json, generated lock file, and generated output, respectively.

## Usage

1. The source code of the package manager is in Typescript. To transpile Typescript into Javascript to be runnable by `node`, run the command `npm run build`. The transpiled `*.js` files will be in the `dist` directory.
2. Create an empty `package.json` file in the `output` directory. You can simply copy over `package.example.json`, rename it, and remove everything in the `dependencies` field.
3. To add dependencies, run the command `node dist/package-manager.js add <somePackage>@<someVersionRange>` which will add the dependency to `package.json`.
4. To install dependencies, run the command `node dist/package-manager.js install`. This will install all dependencies listed in `package.json`, cache tarballs appropriately, and generate a lock file `package-lock.json` in the `output` directory.

### Notes

- The packages will be stored in a generated `output/node_modules` directory.
- The cached tarballs will be stored in a generated `output/.cache` directory.
- Feel free to delete either/both of these directories, as well as the lock file. See how the package manager responds!
- I made the logging very verbose so you can see exactly what the package manager is doing. If this is annoying, I recommend redirecting the output to a file, e.g. `node dist/package-manager.js install > ~/Downloads/output.txt`.

## Overview of Code

First, the `package.json`'s `dependencies` field is checked for any packages. Then, the entire dependency graph is constructed for all of these listed dependencies by querying the NPM registry for all relevant info (exact version, tarball URL, SHA-512 hash, sub-dependencies, etc.). At every sub-dependency, it repeats this process, following a Depth-First Search approach.

Also, any package directly listed in `package.json` is marked as a _direct dependency_. This field is used for the automatic detection of dependency changes between the `package.json` and the lock file. Thanks to the `isDirectDependency` field, we can just filter the graph for those dependencies, compare the locked versions with the resolved versions in the `package.json`, and detect changes appropriately.

As a result, every node in the graph contains the full package metadata necessary to install, lock, and validate the package. If you want to see the dependency graph, just look at the lock file - it's the entire dependency graph serialized and dumped into a file.

The dependency graph follows the format:

```
"axios@1.7.2":  {
	"version":  "1.7.2",
	"tarballUrl":  "https://registry.npmjs.org/axios/-/axios-1.7.2.tgz",
	"hash":  "sha512-2A8QhOMrbomlDuiLeK9XibIBzuHeRcqqNOHp0Cyp5EoJ1IFDh+XZH3A6BkXtv0K4gFGCI0Y4BM7B1wOEi0Rmgw==",
	"isDirectDependency":  true,
	"dependencies":  [
		"follow-redirects@1.15.6",
		"form-data@4.0.0",
		"proxy-from-env@1.1.0"
	]
},
"follow-redirects@1.15.6":  {
	"version":  "1.15.6",
	"tarballUrl":  "https://registry.npmjs.org/follow-redirects/-/follow-redirects-1.15.6.tgz",
	"hash":  "sha512-wWN62YITEaOpSK584EZXJafH1AGpO8RVgElfkuXbTOrPX4fIfOyEpW/CsiNd8JdYrAoOvafRTOEnvsO++qCqFA==",
	"isDirectDependency":  false,
	"dependencies":  [
		...
	]
},
...
```

Another thing to node is that when querying the for packages, it most always follow the `packageIdentifier` format of `<packageName>@<exactVersion>`. This way, every package (even packages with the same name) can be uniquely identified in the graph.

Additionally, every network request when building the graph (requesting the package metadata and versions) is cached in-memory using an LRU cache.

Now that we have the entire dependency graph, we traverse this graph to actually install the packages. Whenever we install a package, we mark it as already installed to avoid re-processing. Additionally, we recursively install all sub-dependencies of a package before installing the package itself. Both of these combined mean we traverse the graph in topological sort fashion, so we avoid cycles.

When we install a package, we prepare the package directory in the `output/node_modules` for installation. Then, we fetch the tarball from either the on-disk cache (`output/.cache`) if available, or the NPM registry. We compute the hash of the tarball and compare it to the expected hash. If there's a mismatch (invalid), we delete the entry in the cache (if it was there), and abort. Otherwise, we extract the contents into the package directory, and write to the cache (if it wasn't there already).

## Future Work

- I would definitely implement comprehensive unit testing. Unfortunately, I didn't have time for this, but I would use the `Jest` framework and unit test all scenarios/permutations of lock files, caches, etc. I did this testing manually, and the code worked in all cases.
- Rather than naively recomputing the entire dependency graph on single changes, it would be much more efficient to calculate a diff, and only update the relevant nodes.
- Many more things.
