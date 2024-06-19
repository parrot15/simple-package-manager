import path from "path";
import { execSync } from "child_process";
import fs from "fs/promises";
import axios from "axios";
import { getPackageJson, doesHashMatch, checkPathExists, parsePackageIdentifier } from "./utils";
import {
  didDependenciesChange,
  buildDependencyGraph,
} from "./graph";
import { CACHE_PATH, LOCK_PATH, NODE_MODULES_PATH } from "./constants";
import { DependencyGraph } from "./types";

export async function saveLockFile(graph: DependencyGraph): Promise<void> {
  // Lock file is just the entire dependency graph serialized into JSON.
  await fs.writeFile(LOCK_PATH, JSON.stringify(graph, null, 2));
  console.log(`Lock file saved at ${LOCK_PATH}`);
}

export async function readLockFile(): Promise<DependencyGraph | null> {
  const lockFileExists = await checkPathExists(LOCK_PATH);
  if (lockFileExists) {
    const fileContents = await fs.readFile(LOCK_PATH, "utf8");
    return JSON.parse(fileContents);
  }
  return null;
}

export async function installPackages(): Promise<void> {
  // Read dependencies in package.json.
  const packageJson = await getPackageJson();
  const dependencies = packageJson.dependencies;
  console.log(`dependencies: ${JSON.stringify(dependencies, null, 2)}`);

  const lockGraph: DependencyGraph | null = await readLockFile();
  if (lockGraph) {
    // The lock file exists, so check package.json's dependencies
    // against the lock file's graph.
    const dependenciesChanged = await didDependenciesChange(
      dependencies,
      lockGraph,
    );
    if (dependenciesChanged) {
      // Something changed, so update dependencies and lock file.
      console.log("Dependencies changed. Updating packages and lock file.");
    } else {
      // Nothing changed, so just install from lock file.
      console.log("----- Installing from lock file -----");
      await installFromGraph(lockGraph);
      return;
    }
  }

  // Lock file or dependencies changed, so do fresh install of all packages.
  console.log("----- Building dependency graph -----");
  let fullGraph: DependencyGraph = {};
  for (const [pkg, version] of Object.entries(dependencies)) {
    const graph = await buildDependencyGraph(pkg, version, true, fullGraph);
    // const graph = await buildDependencyGraph(pkg, version, true);
    // Object.assign(fullGraph, graph);
    // fullGraph = { ...fullGraph, ...graph };
  }
  console.log("----- Installing dependencies -----");
  console.log(`fullGraph:\n${JSON.stringify(fullGraph, null, 2)}`);
  await installFromGraph(fullGraph);
  await saveLockFile(fullGraph);
}


async function installFromGraph(graph: DependencyGraph): Promise<void> {
  const installed = new Set<string>();

  async function installPackage(packageIdentifier: string): Promise<void> {
    if (installed.has(packageIdentifier)) {
      console.log(`Package ${packageIdentifier} already installed, skipping.`);
      return;
    }

    const packageInfo = graph[packageIdentifier];
    if (!packageInfo) {
      throw new Error(`Package ${packageIdentifier} not found in the graph.`);
    }

    // Recursively install all dependencies first
    for (const dependency of packageInfo.dependencies) {
      await installPackage(dependency);
    }




    // const [packageName, packageVersion] = packageIdentifier.split("@");
    const [packageName, packageVersion] = parsePackageIdentifier(packageIdentifier);
    const scopedDir = packageName.startsWith("@")
        ? path.join(NODE_MODULES_PATH, packageName.split("/")[0])
        : NODE_MODULES_PATH;
    const packageDirsSplit = packageName.split("/");
    if (packageDirsSplit && packageDirsSplit.length === 0) {
      throw new Error(`Dependency name ${packageName} is invalid.`);
    }
    const packageDir = path.join(scopedDir, packageDirsSplit.pop() as string);
    const packageDirExists = await checkPathExists(packageDir);
    if (!packageDirExists) {
      await fs.mkdir(packageDir, { recursive: true });
    }

    const tarFilename = `${packageName.replace("/", "-")}-${packageInfo.version}.tgz`;

    let tarData;
    const cacheTarPath = path.join(CACHE_PATH, tarFilename);
    const isTarCached = await checkPathExists(cacheTarPath);

    if (isTarCached) {
      // The tarball is already stored in cache, so retrieve it.
      console.log(`Using cached tarball for ${packageName}@${packageInfo.version}`);
      tarData = await fs.readFile(cacheTarPath);
    } else {
      // The tarball hasn't been cached, so download it.
      console.log(`Downloading tarball from: ${packageInfo.tarballUrl}`);
      const tarballResponse = await axios.get(packageInfo.tarballUrl, {
        responseType: "arraybuffer",
      });
      tarData = tarballResponse.data;
    }

    // Validate the tarball regardless of whether it came from cache or registry.
    const isPackageValid = doesHashMatch(tarData, packageInfo.hash);
    if (isPackageValid) {
      // The hashes matched - validation succeeded.
      console.log(`Validation succeeded for ${packageName}@${packageInfo.version}`);
      // Save tarball to cache if it wasn't already cached.
      if (!isTarCached) {
        console.log(`Caching tarball for ${packageName}@${packageInfo.version}`);
        await fs.writeFile(cacheTarPath, tarData);
      }
      // Extract tarball contents directly from cache into node_modules.
      execSync(`tar -xzf ${cacheTarPath} -C ${packageDir} --strip-components=1`);
      console.log(`Extracted ${packageName}@${packageInfo.version}`);
    } else {
      // The hashes do not match - validation failed.
      // Remove corrupted tar file from cache.
      await fs.unlink(cacheTarPath);
      throw new Error(`Validation failed for ${packageName}@${packageInfo.version}`);
    }




    installed.add(packageIdentifier);
  }

  // Start the installation for all packages in the graph
  for (const packageIdentifier in graph) {
    await installPackage(packageIdentifier);
  }
}


// export async function installFromGraph(
//   graph: DependencyGraph,
//   installed: Set<string> = new Set(),
// ): Promise<void> {
//   for (const [packageIdentifier, packageDetails] of Object.entries(graph)) {
//     // const packageIdentifier = `${packageName}@${packageDetails.version}`;
//     if (installed.has(packageIdentifier)) {
//       console.log(`Package ${packageIdentifier} already installed, skipping.`);
//       continue;
//     }
//     // Check if packageDetails is undefined
//     if (!packageDetails) {
//       console.error(`Package details for ${packageIdentifier} are missing in the graph.`);
//       continue; // Skip this iteration if package details are missing
//     }

//     const [packageName, packageVersion] = packageIdentifier.split("@");

//     // try {
//       const scopedDir = packageName.startsWith("@")
//         ? path.join(NODE_MODULES_PATH, packageName.split("/")[0])
//         : NODE_MODULES_PATH;
//       const packageDirsSplit = packageName.split("/");
//       if (packageDirsSplit && packageDirsSplit.length === 0) {
//         throw new Error(`Dependency name ${packageName} is invalid.`);
//       }
//       const packageDir = path.join(scopedDir, packageDirsSplit.pop() as string);
//       const packageDirExists = await checkPathExists(packageDir);
//       if (!packageDirExists) {
//         await fs.mkdir(packageDir, { recursive: true });
//       }

//       const tarFilename = `${packageName.replace("/", "-")}-${packageDetails.version}.tgz`;

//       let tarData;
//       const cacheTarPath = path.join(CACHE_PATH, tarFilename);
//       const isTarCached = await checkPathExists(cacheTarPath);

//       if (isTarCached) {
//         // The tarball is already stored in cache, so retrieve it.
//         console.log(`Using cached tarball for ${packageName}@${packageDetails.version}`);
//         tarData = await fs.readFile(cacheTarPath);
//       } else {
//         // The tarball hasn't been cached, so download it.
//         console.log(`Downloading tarball from: ${packageDetails.tarballUrl}`);
//         const tarballResponse = await axios.get(packageDetails.tarballUrl, {
//           responseType: "arraybuffer",
//         });
//         tarData = tarballResponse.data;
//       }

//       // Validate the tarball regardless of whether it came from cache or registry.
//       const isPackageValid = doesHashMatch(tarData, packageDetails.hash);
//       if (isPackageValid) {
//         // The hashes matched - validation succeeded.
//         console.log(`Validation succeeded for ${packageName}@${packageDetails.version}`);
//         // Save tarball to cache if it wasn't already cached.
//         if (!isTarCached) {
//           console.log(`Caching tarball for ${packageName}@${packageDetails.version}`);
//           await fs.writeFile(cacheTarPath, tarData);
//         }
//         // Extract tarball contents directly from cache into node_modules.
//         execSync(`tar -xzf ${cacheTarPath} -C ${packageDir} --strip-components=1`);
//         console.log(`Extracted ${packageName}@${packageDetails.version}`);
//         // Mark this package as installed.
//         installed.add(packageIdentifier);
//         // Continue traversing dependency graph.
//         for (const depIdentifier of packageDetails.dependencies) {
//           // await installFromGraph({ [depIdentifier]: graph[depIdentifier] }, installed);
//           if (!graph[depIdentifier]) {
//             console.error(`Dependency ${depIdentifier} not found in graph.`);
//             continue; // Skip missing dependencies
//           }
//           await installFromGraph(graph, installed);
//         }
//         // await installFromGraph(packageDetails.dependencies, installed);
//       } else {
//         // The hashes do not match - validation failed.
//         // Remove corrupted tar file from cache.
//         await fs.unlink(cacheTarPath);
//         throw new Error(`Validation failed for ${packageName}@${packageDetails.version}`);
//       }
//     // } catch (error: any) {
//     //   if (axios.isAxiosError(error)) {
//     //     const errorMessage = `Failed to install ${packageName}@${packageDetails.version}: ${error.message}`;
//     //     console.error(errorMessage);
//     //     if (error.response) {
//     //       console.error(
//     //         `HTTP status: ${error.response.status}. ${error.response.statusText}`,
//     //       );
//     //     }
//     //   } else if (error instanceof Error) {
//     //     console.error(error.message);
//     //   } else {
//     //     console.error(`An unknown error occurred.`);
//     //   }
//     //   process.exit(1);
//     // }
//   }
// }
