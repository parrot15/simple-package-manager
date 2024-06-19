# Continue take-home exercise

## Intro

- This is a 120-minute exercise
- The goal is to build a very basic version of a NodeJS package manager
- You can use whichever language, third-party dependencies, and resources you’d like (we encourage you to use Continue as much as possible!)
- Package managers are complex, so we don’t expect yours to be full-featured
- Once you are done, please share your code with [nate@continue.dev](mailto:nate@continue.dev) and [ty@continue.dev](mailto:ty@continue.dev) in a GitHub repository

## Background

NodeJS lets you use packages built by others by including them in a folder called “node_modules”. But how the packages arrive in that folder is a question left to package managers.

The original NodeJS Package Manager (NPM) is commonly used, but has a number of alternatives, including Yarn, PNPM, and Bun’s package manager. Each of them makes it easy to add new packages to your project and keep track of them. [1]

Since NPM was built first, their “registry” (the hosting server where people publish packages and download them from for use) is used in almost all cases. You can search through packages on the registry by going to https://npmjs.com.

Let’s say you’re installing [`is-thirteen`](https://www.npmjs.com/package/is-thirteen), a useful package that tells you whether a number is equal to thirteen. When you type `npm install is-thirteen`, the NPM program will interact with the registry’s API to gather information on the package, it’s dependencies, and the data that should be downloaded into node_modules. This same API is the one that you will use to build your package manager, and you can find the documentation here: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md

Package managers have many commands. These are all of the commands for NPM:

> access, adduser, audit, bugs, cache, ci, completion,
> config, dedupe, deprecate, diff, dist-tag, docs, doctor,
> edit, exec, explain, explore, find-dupes, fund, get, help,
> help-search, hook, init, install, install-ci-test,
> install-test, link, ll, login, logout, ls, org, outdated,
> owner, pack, ping, pkg, prefix, profile, prune, publish,
> query, rebuild, repo, restart, root, run-script, sbom,
> search, set, shrinkwrap, star, stars, start, stop, team,
> test, token, uninstall, unpublish, unstar, update, version,
> view, whoami

But we want you to focus on two commands: “add” and “install”

## Task

By the end of the exercise, the goal is to have some end-to-end working version of these commands. It is okay to make choices that leave out functionality or provide imperfect behavior—we’d rather see an effort to have _something_ that can do the full thing for at least a basic scenario.

1. `add <package_name>` - Adds the dependency to the “dependencies” object in package.json
   - This will take a single argument, which is the name of the package
   - The package might include a version, delimited by “@” like “is-thirteen@0.1.13”, which it should parse
   - It should write to an _existing_ (you can create it manually or with `npm init`) package.json to add `"is-thirteen": "0.1.13"` to the `dependencies` object
2. `install` - Downloads all of the packages that are specified in package.json, as well as package that are dependencies of these
   - Should read the `dependencies` object of the package.json
   - Assume that the node_modules folder is currently empty, rather than trying to determine what exists or not
   - Determine all dependencies of dependencies
   - Download each to the node_modules folder

Package managers are very complex programs, so there’s no expectation to make yours perfect. You’ll probably run into any of the below nuances, or even ones we haven’t listed here. We encourage you, if time permits, to attempt to solve at least one of the below problems. The solution might be algorithmic, or it might be a UI decision (e.g. simply warn the user if there is a conflict).

- Dependency conflict resolution: what happens if two dependencies require different versions of another dependency?
- Lock file: How can you make sure that installs are deterministic?
- Caching: It’s a waste of storage and time to be redownloading a package that you’ve already downloaded for another project. How can you save something globally to avoid extra downloads? Are there different levels of efficiency you could achieve?
- Validation: How can you verify that an installation of a package is correct?
- Circular dependencies: What happens if there is a dependency graph like A → B → C → A?
- Fun animations

## Conclusion

This is just for fun and not at all necessary to share, but if you wrote your code in Node.js: Once you’re done, try running your code using your own package manager! Use your `add` command to add all of the dependencies to output/package.json, run your `install` command to download everything to output/node_modules, and then copy output/node_modules to node_modules.

[1] Another project, [Deno](https://docs.deno.com/runtime/tutorials/manage_dependencies), takes an approach that doesn’t need a package manager at all in the usual sense.
