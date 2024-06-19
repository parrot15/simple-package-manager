import semver from "semver";
import { DependencyGraph, PackageInfo } from "./types";
import { getPackageInfo, parsePackageIdentifier, resolveVersion } from "./utils";

export async function buildDependencyGraph(
  packageName: string,
  // versionRange: string,
  exactVersion: string,
  directDependency: boolean = false,
  graph: DependencyGraph = {},
): Promise<void> {
  // const resolvedVersion = await resolveVersion(packageName, versionRange);
  // const packageIdentifier = `${packageName}@${resolvedVersion}`;
  const packageIdentifier = `${packageName}@${exactVersion}`;

  if (graph[packageIdentifier]) {
    // Package already exists in the graph.
    if (graph[packageIdentifier].isDirectDependency) {
      // If it's a direct dependency, ensure it remains so.
      graph[packageIdentifier].isDirectDependency = true;
    }
    return;
  }

  // const packageInfo: PackageInfo = await getPackageInfo(packageName, resolvedVersion);
  const packageInfo: PackageInfo = await getPackageInfo(packageName, exactVersion);
  packageInfo.isDirectDependency = directDependency;
  // const dependencies = packageInfo.dependencies || [];

  // const dependencyIdentifiers = await Promise.all(dependencies.map(
  //   async (depIdentifier) => {
  //     const [ depName, depVersion ] = parsePackageIdentifier(depIdentifier);
  //     const exactVersion = await resolveVersion(depName, depVersion as string);
  //     return `${depName}@${exactVersion}`;
  //   }
  // ));
  // graph[packageIdentifier] = {
  //   ...packageInfo,
  //   isDirectDependency: directDependency,
  //   // dependencies: dependencyIdentifiers,
  // };
  graph[packageIdentifier] = packageInfo;

  // Recursively build graphs for dependencies and merge them.
  // // for (const [depName, depVersion] of Object.entries(dependencies)) {
  // for (const [depName, depVersionRange] of Object.entries(packageInfo.dependencies)) {
  //   await buildDependencyGraph(depName, depVersionRange as string, false, graph);
  // }

  for (const depIdentifier of packageInfo.dependencies) {
    const [depName, depVersion] = parsePackageIdentifier(depIdentifier);
    await buildDependencyGraph(depName, depVersion as string, false, graph);
  }
}


export async function didDependenciesChange(packageJsonDependencies: Record<string, string>, lockGraph: DependencyGraph): Promise<boolean> {
  // Only consider the direct dependencies in the lock graph.
  const directDependencies: Record<string, string> = Object.entries(lockGraph)
    .filter(([_, packageInfo]) => packageInfo.isDirectDependency)
    .reduce((acc, [packageIdentifier, packageInfo]) => {
      const [packageName, version] = parsePackageIdentifier(packageIdentifier);
      acc[packageName] = version;
      return acc;
    }, {} as Record<string, string>);
  console.log("Direct dependencies from lock graph:", JSON.stringify(directDependencies, null, 2));

  // Check for any added or changed dependencies.
  for (const [pkg, versionRange] of Object.entries(packageJsonDependencies)) {
    const lockedVersion = directDependencies[pkg];
    if (!lockedVersion) {
      // A new dependency was added.
      console.log(`New dependency ${pkg} added.`);
      return true;
    }

    if (!semver.satisfies(lockedVersion, versionRange)) {
      // A dependency's version range changed.
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
