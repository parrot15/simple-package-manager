import semver from "semver";
import { DependencyGraph, PackageInfo } from "./types";
import { getPackageInfo, parsePackageIdentifier } from "./utils";

/**
 * Builds the dependency graph for a given package and exact version.
 * @param packageName The name of a package.
 * @param exactVersion The exact version of a package, e.g. "1.7.2",
 * "2.1.35", "10.2.2", etc.
 * @param directDependency Whether the package was directly specified
 * in package.json (direct dependency) or a sub-dependency (transitive
 * dependency).
 * @param graph The graph object to which dependencies should be added.
 */
export async function buildDependencyGraph(
  packageName: string,
  exactVersion: string,
  directDependency: boolean = false,
  graph: DependencyGraph = {},
): Promise<void> {
  const packageIdentifier = `${packageName}@${exactVersion}`;

  // Check if the package already exists in the dependency graph to avoid
  // redundant work.
  if (graph[packageIdentifier]) {
    // If it's a direct dependency, ensure it remains so.
    if (graph[packageIdentifier].isDirectDependency) {
      graph[packageIdentifier].isDirectDependency = true;
    }
    return;
  }

  // Fetch detailed information about the package, including its dependencies.
  const packageInfo: PackageInfo = await getPackageInfo(
    packageName,
    exactVersion,
  );
  // Ensure package is marked as direct/transitive dependency if explicitly
  // specified (e.g. in package.json).
  packageInfo.isDirectDependency = directDependency;
  // Add package information to the graph.
  graph[packageIdentifier] = packageInfo;

  // Loop through all of the package's dependencies.
  for (const depIdentifier of packageInfo.dependencies) {
    // Extract package name and exact version from the package identifier
    // of this dependency.
    const [depName, depVersion] = parsePackageIdentifier(depIdentifier);
    // Recursively build the graph for each of the package's dependencies.
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
 * @param lockedGraph The dependency graph in the lock file.
 * @returns Promise of whether any dependencies changed.
 */
export async function didDependenciesChange(
  packageJsonDependencies: Record<string, string>,
  lockedGraph: DependencyGraph,
): Promise<boolean> {
  // Construct a mapping with only direct dependencies in the locked graph.
  // Keys are the package names, values are their exact locked versions.
  const directDependencies: Record<string, string> = Object.entries(lockedGraph)
    // Filter locked graph entries to only consider direct dependencies.
    .filter(([_, packageInfo]) => packageInfo.isDirectDependency)
    // Reduce graph entries to a mapping between package name and its
    // exact locked version.
    .reduce(
      (acc, [packageIdentifier, _]) => {
        const [packageName, exactVersion] =
          parsePackageIdentifier(packageIdentifier);
        acc[packageName] = exactVersion;
        return acc;
      },
      {} as Record<string, string>,
    );

  // Check for any added or changed dependencies.
  for (const [packageName, versionRange] of Object.entries(
    packageJsonDependencies,
  )) {
    const lockedVersion = directDependencies[packageName];
    if (!lockedVersion) {
      // A new dependency was added.
      console.log(`New dependency ${packageName} added.`);
      return true;
    }

    if (!semver.satisfies(lockedVersion, versionRange)) {
      // A dependency's version range changed in such a way that
      // the exact version in the lock file is no longer sufficient.
      console.log(`Dependency ${packageName} version changed.`);
      return true;
    }
  }

  // Check for any removed dependencies.
  for (const packageName of Object.keys(directDependencies)) {
    if (!packageJsonDependencies.hasOwnProperty(packageName)) {
      // A dependency was removed.
      console.log(`Dependency ${packageName} removed`);
      return true;
    }
  }

  return false;
}
