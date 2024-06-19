/**
 * Represents detailed information about a package.
 */
export interface PackageInfo {
  // Exact version of the package, e.g. "7.6.2".
  version: string;
  // URL of the tarball from where the package can be downloaded.
  tarballUrl: string;
  // The expected hash of the tarball for integrity/validation.
  hash: string;
  // Whether the package is a direct dependency (directly specified
  // in package.json).
  isDirectDependency: boolean;
  // List of all sub-dependencies for this package, represented as
  // package identifiers ("packageName@exactVersion"). For example,
  // "semver@7.6.2", "is-glob@4.0.3", etc.
  dependencies: string[];
}

/**
 * Represents the graph of all dependencies, where each key is a
 * package identifier which uniquely identifies a package, and
 * each value is a PackageInfo object. We can easily traverse the
 * graph thanks to the 'dependencies' field in PackageInfo which
 * only stores package identifiers.
 */
export interface DependencyGraph {
  [packageIdentifier: string]: PackageInfo;
}

/**
 * Represents the dependencies section of the package.json file.
 */
export interface PackageJson {
  // Map of all the dependencies, where the key is the package name,
  // and the value is the version range. For example:
  // "semver": "^7.6.2"
  dependencies: Record<string, string>;
}
