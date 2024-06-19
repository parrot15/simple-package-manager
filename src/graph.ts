import semver from "semver";
import axios from "axios";
import { DependencyGraph, PackageInfo } from "./types";
import { getPackageInfo, parsePackageIdentifier, resolveVersion } from "./utils";

// export interface DependencyGraph {
//   [packageIdentifier: string]: PackageInfo;
// }

// export interface PackageInfo {
//   version: string;
//   tarballUrl: string;
//   hash: string;
//   // dependencies: DependencyGraph;
//   isDirectDependency: boolean;
//   dependencies: string[];
// }

export async function buildDependencyGraph(
  packageName: string,
  version: string,
  directDependency: boolean = false,
  graph: DependencyGraph = {},
): Promise<DependencyGraph> {
  const resolvedVersion = await resolveVersion(packageName, version);
  const packageIdentifier = `${packageName}@${resolvedVersion}`;

  if (graph[packageIdentifier]) {
    // Package already exists in the graph.
    if (graph[packageIdentifier].isDirectDependency) {
      // Ensure it remains a direct dependency if it is one.
      graph[packageIdentifier].isDirectDependency = true;
    }
    return graph;
  }

  const packageInfo: PackageInfo = await getPackageInfo(packageName, resolvedVersion);
  const dependencies = packageInfo.dependencies || {};

  // const registryUrl = `https://registry.npmjs.org/${packageName}/${resolvedVersion}`;
  // console.log(`Fetching info for: ${registryUrl}`);
  // const response = await axios.get(registryUrl);

  // const packageVersion = response.data.version;
  // // const packageIdentifier = `${packageName}@${packageVersion}`;
  // const dependencies = response.data.dependencies || [];
  // const tarballUrl = response.data.dist.tarball;
  // const hash = response.data.dist.integrity;
  // // const dependencyIdentifiers = Object.entries(dependencies).map(
  // //   ([depName, depVersion]) => `${depName}@${depVersion}`
  // // )
  // // const dependencyPromises = Object.entries(dependencies).map(
  // //   ([depName, depVersion]) => resolveVersion(depName, depVersion as string)
  // // );
  const dependencyIdentifiers = await Promise.all(Object.entries(dependencies).map(
    async ([depName, depVersion]) => {
      const exactVersion = await resolveVersion(depName, depVersion as string);
      return `${depName}@${exactVersion}`;
    }
  ));
  graph[packageIdentifier] = {
    ...packageInfo,
    isDirectDependency: directDependency,
    dependencies: dependencyIdentifiers,
  };
  // graph[packageIdentifier] = {
  //   // [packageName]: {
  //   // [packageIdentifier]: {
  //     version: packageVersion,
  //     tarballUrl: tarballUrl,
  //     hash: hash,
  //     // dependencies: {},
  //     isDirectDependency: directDependency,
  //     dependencies: dependencyIdentifiers,
  //   // },
  // };

  // Recursively build graphs for dependencies and merge them.
  for (const [depName, depVersion] of Object.entries(dependencies)) {
    await buildDependencyGraph(depName, depVersion as string, false, graph);
    // const depGraph = await buildDependencyGraph(depName, depVersion as string);
    // Object.assign(graph, depGraph);
  }

  // // Gather all dependency promises.
  // const dependencyPromises = Object.entries(dependencies).map(
  //   ([depName, depVersion]) =>
  //     buildDependencyGraph(depName, depVersion as string),
  // );

  // // Resolve all dependency promises in parallel for efficiency.
  // const resolvedDependencies = await Promise.all(dependencyPromises);
  // resolvedDependencies.forEach((depGraph, index) => {
  //   const depName = Object.keys(dependencies)[index];
  //   graph[packageName].dependencies[depName] = depGraph[depName];
  // });

  return graph;
}

// export async function didDependenciesChange(
//   packageJsonDependencies: Record<string, string>,
//   lockGraph: DependencyGraph,
// ): Promise<boolean> {
//   for (const [pkg, versionRange] of Object.entries(packageJsonDependencies)) {
//     if (!lockGraph[pkg]) {
//       // A new dependency was added.
//       return true;
//     }
//     const lockedVersion = lockGraph[pkg].version;
//     if (!semver.satisfies(lockedVersion, versionRange)) {
//       // A dependency version changed.
//       return true;
//     }
//   }

//   for (const pkg of Object.keys(lockGraph)) {
//     if (!packageJsonDependencies.hasOwnProperty(pkg)) {
//       // A dependency was removed.
//       return true;
//     }
//   }

//   return false;
// }


export async function didDependenciesChange(packageJsonDependencies: Record<string, string>, lockGraph: DependencyGraph): Promise<boolean> {
  // Only consider the direct dependencies in the lock graph.
  // const directDependencies = Object.fromEntries(Object.entries(lockGraph).filter(([_, packageInfo]) => packageInfo.isDirectDependency));
  const directDependencies: Record<string, string> = Object.entries(lockGraph)
    .filter(([_, packageInfo]) => packageInfo.isDirectDependency)
    .reduce((acc, [packageIdentifier, packageInfo]) => {
      const [packageName, version] = parsePackageIdentifier(packageIdentifier);
      acc[packageName] = version;
      return acc;
    }, {} as Record<string, string>);
  console.log("Direct dependencies from lock graph:", JSON.stringify(directDependencies, null, 2));
  // console.log("Direct Dependencies from Lock Graph:", JSON.stringify(
  //   Object.fromEntries(Object.entries(directDependencies).map(([key, value]) => [key, Array.from(value)])),
  //   null,
  //   2
  // ));

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



// export async function didDependenciesChange(packageJsonDependencies: Record<string, string>, lockGraph: DependencyGraph): Promise<boolean> {
//   // Extract package names and versions from the lockGraph keys.
//   // Converts format to Record<string, string> for direct
//   // comparison with packageJsonDependencies.
//   // const lockGraphPackages = Object.keys(lockGraph).reduce((acc, packageIdentifier) => {
//   //   const [packageName, version] = parsePackageIdentifier(packageIdentifier);
//   //   acc[packageName] = version;
//   //   return acc;
//   // }, {} as Record<string, string>);

//   // Extract package names and versions available from lockGraph's keys.
//   // Store in a map where each package name maps to a set of versions
//   // available in the lockGraph.
//   const lockGraphPackages = new Map<string, Set<string>>();
//   for (const packageIdentifier of Object.keys(lockGraph)) {
//     const [packageName, version] = parsePackageIdentifier(packageIdentifier);
//     // New package name, so map it to an empty set.
//     if (!lockGraphPackages.has(packageName)) {
//       lockGraphPackages.set(packageName, new Set<string>());
//     }
//     // Add version to package name's mapped set of versions.
//     lockGraphPackages.get(packageName)?.add(version);
//   }

//   console.log("Lock Graph Packages:", JSON.stringify(Object.fromEntries(
//     Array.from(lockGraphPackages.entries()).map(([key, value]) => [key, Array.from(value)])
//   ), null, 2));

//   // Check for any added or changed dependencies.
//   for (const [pkg, versionRange] of Object.entries(packageJsonDependencies)) {
//     const lockedVersions = lockGraphPackages.get(pkg);
//     if (!lockedVersions) {
//       // A new dependency was added.
//       console.log(`New dependency ${pkg} added.`);
//       return true;
//     }

//     // Check if version range in package.json satisfies any versions
//     // in the lockGraph.
//     let isSatisfied = false;
//     lockedVersions.forEach(lockedVersion => {
//       // console.log(`Checking if ${lockedVersion} satisfies ${versionRange}`);
//       if (semver.satisfies(lockedVersion, versionRange)) {
//         isSatisfied = true;
//         console.log(`Dependency ${pkg} match between ${lockedVersion} and ${versionRange}.`);
//       }
//     });
//     if (!isSatisfied) {
//       // None of the versions satisfy the version range, so the
//       // dependency's version range must have changed.
//       console.log(`Dependency ${pkg} version changed.`);
//       return true;
//     }
//   }

//   // Check for any removed dependencies.
//   // for (const pkg of Object.keys(packageJsonDependencies)) {
//   //   if (!lockGraphPackages.get(pkg)) {
//   //     // A dependency was removed.
//   //     console.log(`Dependency ${pkg} removed.`);
//   //     return true;
//   //   }
//   // }

//   // Check for any removed dependencies.
//   for (const pkg of lockGraphPackages.keys()) {
//     if (!packageJsonDependencies.hasOwnProperty(pkg)) {
//       // A dependency was removed.
//       console.log(`Dependency ${pkg} removed.`);
//       return true;
//     }
//   }

//   return false;
// }
