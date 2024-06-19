import path from "path";
import { execSync } from "child_process";
import fs from "fs/promises";
import axios from "axios";
import { getPackageJson, doesHashMatch, checkPathExists, parsePackageIdentifier, resolveVersion } from "./utils";
import {
  didDependenciesChange,
  buildDependencyGraph,
} from "./graph";
import { saveLockFile, readLockFile } from "./utils";
import { CACHE_PATH, NODE_MODULES_PATH } from "./constants";
import { DependencyGraph, PackageInfo } from "./types";

export async function determinePackageInstallation(): Promise<void> {
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
      await cleanupUnusedPackages(lockGraph);
      return;
    }
  }

  // Lock file or dependencies changed, so do fresh install of all packages.
  console.log("----- Building dependency graph -----");
  let fullGraph: DependencyGraph = {};
  for (const [packageName, versionRange] of Object.entries(dependencies)) {
    // const graph = await buildDependencyGraph(pkg, version, true, fullGraph);
    const exactVersion = await resolveVersion(packageName, versionRange);
    await buildDependencyGraph(packageName, exactVersion, true, fullGraph);
    // const graph = await buildDependencyGraph(pkg, version, true);
    // Object.assign(fullGraph, graph);
    // fullGraph = { ...fullGraph, ...graph };
  }
  console.log("----- Installing dependencies -----");
  console.log(`fullGraph:\n${JSON.stringify(fullGraph, null, 2)}`);
  await installFromGraph(fullGraph);
  await cleanupUnusedPackages(fullGraph);
  await saveLockFile(fullGraph);
}

// Prune any unused dependencies in the node_modules folder.
async function cleanupUnusedPackages(graph: DependencyGraph): Promise<void> {
  console.log(`INSIDE CLEANUP`);
  // The packages currently in the node_modules folder.
  const existingPackages = await fs.readdir(NODE_MODULES_PATH);
  // The correct packages computed in the dependency graph.
  const correctPackages = new Set<string>();
  for (const key of Object.keys(graph)) {
    const [ packageName ] = parsePackageIdentifier(key);
    if (packageName.includes("/")) {
      // Scoped package, so add both the scoped directory and
      // the full package name.
      const parts = packageName.split("/");
      correctPackages.add(parts[0]);
      correctPackages.add(packageName);
    } else {
      correctPackages.add(packageName);
    }
  }
  // const correctPackages = new Set(Object.keys(graph).map(key => {
  //   const [ packageName ] = parsePackageIdentifier(key);
  //   return packageName;
  // }));

  // Iterate through all packages currently in the node_modules folder.
  for (const existingPackage of existingPackages) {
    // The package is not in the dependency graph, so it must be a
    // stale (unused) package.
    if (!correctPackages.has(existingPackage)) {
      // const cacheTarPath = path.join(CACHE_PATH, tarFilename);
      const packagePath = path.join(NODE_MODULES_PATH, existingPackage);
      console.log(`Removing unused package ${existingPackage}.`);
      await fs.rm(packagePath, { recursive: true });
    }
  }
}

async function installFromGraph(graph: DependencyGraph): Promise<void> {
  // Start the installation for all packages in the graph
  const installed = new Set<string>();
  for (const packageIdentifier in graph) {
    try {
      await installPackage(packageIdentifier, graph, installed);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const errorMessage = `Failed to install ${packageIdentifier}: ${error.message}`;
        console.error(errorMessage);
        if (error.response) {
          console.error(
            `HTTP status: ${error.response.status}. ${error.response.statusText}`,
          );
        }
      } else if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error(`An unknown error occurred.`);
      }
      process.exit(1);
    }
  }
}

async function installPackage(packageIdentifier: string, graph: DependencyGraph, installed: Set<string>): Promise<void> {
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
    await installPackage(dependency, graph, installed);
  }

  const [ packageName ] = parsePackageIdentifier(packageIdentifier);
  const packageDir = await preparePackageDirectory(packageName);

  const tarFilename = `${packageName.replace("/", "-")}-${packageInfo.version}.tgz`;
  const [ tarData, isTarCached ] = await retrieveTarball(packageName, packageInfo, tarFilename);
  await extractTarball(packageName, packageInfo, tarFilename, tarData, isTarCached, packageDir);

  installed.add(packageIdentifier);
}

async function preparePackageDirectory(packageName: string): Promise<string> {
  const scopedDir = packageName.startsWith("@")
      ? path.join(NODE_MODULES_PATH, packageName.split("/")[0])
      : NODE_MODULES_PATH;
  const packageDirsSplit = packageName.split("/");
  if (packageDirsSplit.length === 0) {
    throw new Error(`Dependency name ${packageName} is invalid.`);
  }
  const packageDir = path.join(scopedDir, packageDirsSplit.pop() as string);
  const packageDirExists = await checkPathExists(packageDir);
  if (!packageDirExists) {
    await fs.mkdir(packageDir, { recursive: true });
  }

  return packageDir;
}

async function retrieveTarball(packageName: string, packageInfo: PackageInfo, tarFilename: string): Promise<[Buffer, boolean]> {
  const cacheTarPath = path.join(CACHE_PATH, tarFilename);
  const isTarCached = await checkPathExists(cacheTarPath);

  if (isTarCached) {
    // The tarball is already stored in cache, so retrieve it.
    console.log(`Using cached tarball for ${packageName}@${packageInfo.version}`);
    return [await fs.readFile(cacheTarPath), true];
  } else {
    // The tarball hasn't been cached, so download it.
    console.log(`Downloading tarball from: ${packageInfo.tarballUrl}`);
    const tarballResponse = await axios.get(packageInfo.tarballUrl, {
      responseType: "arraybuffer",
    });
    return [tarballResponse.data, false];
  }
}

async function extractTarball(packageName: string, packageInfo: PackageInfo, tarFilename: string, tarData: Buffer, isTarCached: boolean, packageDir: string): Promise<void> {
  const cacheTarPath = path.join(CACHE_PATH, tarFilename);
  const isPackageValid = doesHashMatch(tarData, packageInfo.hash);
  if (isPackageValid) {
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
}
