import semver from "semver";
import { DependencyGraph, PackageInfo } from "./types";
import { getPackageInfo, parsePackageIdentifier } from "./utils";

/**
 * Builds the dependency graph for a given package and exact version.
 * @param packageName The name of a package.
 * @param exactVersion The exact version of a package, e.g. "1.7.2",
 * "2.1.35", "10.2.2", etc.
 * @param directDependency Whether the package was directly specified
 * in package.json.
 * @param graph The graph object to which dependencies should be added.
 */
export async function buildDependencyGraph(
  packageName: string,
  exactVersion: string,
  directDependency: boolean = false,
  graph: DependencyGraph = {},
): Promise<void> {
  const packageIdentifier = `${packageName}@${exactVersion}`;

  if (graph[packageIdentifier]) {
    // Package already exists in the graph.
    if (graph[packageIdentifier].isDirectDependency) {
      // If it's a direct dependency, ensure it remains so.
      graph[packageIdentifier].isDirectDependency = true;
    }
    return;
  }

  const packageInfo: PackageInfo = await getPackageInfo(
    packageName,
    exactVersion,
  );
  packageInfo.isDirectDependency = directDependency;
  graph[packageIdentifier] = packageInfo;

  for (const depIdentifier of packageInfo.dependencies) {
    const [depName, depVersion] = parsePackageIdentifier(depIdentifier);
    await buildDependencyGraph(depName, depVersion as string, false, graph);
  }
}

/**
 * Determines whether the dependencies in the package.json have changed
 * relative to the lock file. We only consider direct dependencies.
 * Dependencies that are directly specified in the package.json are considered
 * 'direct dependencies' (PackageInfo.isDirectDependency = true). This way,
 * we can easily track the package.json's dependencies.
 * @param packageJsonDependencies The dependencies in the package.json.
 * @param lockGraph The dependency graph in the lock file.
 * @returns Promise of whether any dependencies changed.
 */
export async function didDependenciesChange(
  packageJsonDependencies: Record<string, string>,
  lockGraph: DependencyGraph,
): Promise<boolean> {
  // Only consider the direct dependencies in the lock graph.
  const directDependencies: Record<string, string> = Object.entries(lockGraph)
    .filter(([_, packageInfo]) => packageInfo.isDirectDependency)
    .reduce(
      (acc, [packageIdentifier, packageInfo]) => {
        const [packageName, version] =
          parsePackageIdentifier(packageIdentifier);
        acc[packageName] = version;
        return acc;
      },
      {} as Record<string, string>,
    );
  console.log(
    "Direct dependencies from lock graph:",
    JSON.stringify(directDependencies, null, 2),
  );

  // Check for any added or changed dependencies.
  for (const [pkg, versionRange] of Object.entries(packageJsonDependencies)) {
    const lockedVersion = directDependencies[pkg];
    if (!lockedVersion) {
      // A new dependency was added.
      console.log(`New dependency ${pkg} added.`);
      return true;
    }

    if (!semver.satisfies(lockedVersion, versionRange)) {
      // A dependency's version range changed in such a way that
      // the exact version in the lock file is no longer sufficient.
      console.log(`Dependency ${pkg} version changed.`);
      return true;
    }
  }

  // Check for any removed dependencies.
  for (const pkg of Object.keys(directDependencies)) {
    if (!packageJsonDependencies.hasOwnProperty(pkg)) {
      // A dependency was removed.
      console.log(`Dependency ${pkg} removed`);
      return true;
    }
  }

  return false;
}
