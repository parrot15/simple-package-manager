import path from "path";
import { execSync } from "child_process";
import fs from "fs/promises";
import axios from "axios";
import {
  getPackageJson,
  doesHashMatch,
  checkPathExists,
  parsePackageIdentifier,
  resolveVersion,
} from "./utils";
import { didDependenciesChange, buildDependencyGraph } from "./graph";
import { saveLockFile, readLockFile } from "./utils";
import { CACHE_PATH, NODE_MODULES_PATH } from "./constants";
import { DependencyGraph, PackageInfo } from "./types";

/**
 * Determines and executes the the necessary package installation flow (when
 * to read/update lock file, rebuild entire dependency graph, clean up unused
 * packages, save the lock file, etc.).
 * For simplicity, if any dependency in the package.json changes, the entire
 * dependency graph is re-built and the lock file will be entirely re-generated.
 * The overall flow is:
 * 1. If there's a lock file, read it and check if any dependency changed
 *    between the package.json and the lock file.
 * 2. If nothing changed, just install from the lock file.
 * 3. Otherwise, re-build the entire dependency graph and save the new lock file.
 * 4. Clean up any unused packages in the node_modules directory.
 */
export async function determinePackageInstallation(): Promise<void> {
  // Read dependencies in package.json.
  const packageJson = await getPackageJson();
  const dependencies = packageJson.dependencies;

  const lockedGraph: DependencyGraph | null = await readLockFile();
  if (lockedGraph) {
    // The lock file exists, so check package.json's dependencies
    // against the lock file's graph.
    const dependenciesChanged = await didDependenciesChange(
      dependencies,
      lockedGraph,
    );
    if (dependenciesChanged) {
      // Something changed, so update dependencies and lock file.
      console.log("Dependencies changed. Updating packages and lock file.");
    } else {
      // Nothing changed, so just install from lock file.
      console.log("----- Installing from lock file -----");
      // Install from the lock file's dependency graph.
      await installFromGraph(lockedGraph);
      // Prune any packages that are no longer needed.
      await cleanupUnusedPackages(lockedGraph);
      return;
    }
  }

  // Lock file or dependencies changed, so do fresh install of all packages.
  console.log("----- Building dependency graph -----");
  // Build the entire dependency graph.
  let fullGraph: DependencyGraph = {};
  // Loop through each dependency listed in the package.json.
  for (const [packageName, versionRange] of Object.entries(dependencies)) {
    // Resolve each dependency's version range to its exact version.
    const exactVersion = await resolveVersion(packageName, versionRange);
    // Build the dependency graph.
    await buildDependencyGraph(packageName, exactVersion, true, fullGraph);
  }
  console.log("----- Installing dependencies -----");
  // Traverse the full dependency graph to install all packages.
  await installFromGraph(fullGraph);
  // Prune any packages that are no longer needed.
  await cleanupUnusedPackages(fullGraph);
  // Save the new lock file.
  await saveLockFile(fullGraph);
}

/**
 * Cleans up any unused packages from the node_modules directory. This can
 * occur when a dependency version changes. For example, if you install
 * "semver@7.5.2", it has a sub-dependency called "yallist". Now, when you
 * change it to "semver@7.6.2", it no longer has this sub-dependency. But
 * "yallist" will still be in node_modules. This function takes care of that
 * edge case.
 * @param graph The dependency graph.
 */
async function cleanupUnusedPackages(graph: DependencyGraph): Promise<void> {
  // The packages currently in the node_modules folder.
  const existingPackages = await fs.readdir(NODE_MODULES_PATH);
  // The correct packages computed in the dependency graph.
  const correctPackages = new Set<string>();
  for (const key of Object.keys(graph)) {
    const [packageName] = parsePackageIdentifier(key);
    if (packageName.includes("/")) {
      // Scoped package, so add both the scoped directory and
      // the full package name.
      const parts = packageName.split("/");
      correctPackages.add(parts[0]);
    }
    correctPackages.add(packageName);
  }

  // Iterate through all packages currently in the node_modules folder.
  for (const existingPackage of existingPackages) {
    // The package is not in the dependency graph, so it must be a
    // stale (unused) package. Remove it.
    if (!correctPackages.has(existingPackage)) {
      const packagePath = path.join(NODE_MODULES_PATH, existingPackage);
      console.log(`Removing unused package ${existingPackage}.`);
      await fs.rm(packagePath, { recursive: true });
    }
  }
}

/**
 * Installs all packages specified in the dependency graph. If any error
 * occurs, displays the error appropriately and aborts the installation.
 * @param graph The dependency graph.
 */
async function installFromGraph(graph: DependencyGraph): Promise<void> {
  // Set to keep track of already installed packages to avoid redundant processing.
  const installed = new Set<string>();
  // Loop through each package in dependency graph.
  for (const packageIdentifier in graph) {
    try {
      // Install the package and its dependencies recursively.
      await installPackage(packageIdentifier, graph, installed);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        // Network-related error.
        const errorMessage = `Failed to install ${packageIdentifier}: ${error.message}`;
        console.error(errorMessage);
        if (error.response) {
          console.error(
            `HTTP status: ${error.response.status}. ${error.response.statusText}`,
          );
        }
      } else if (error instanceof Error) {
        // Generic errors.
        console.error(error.message);
      } else {
        // Unknown errors.
        console.error(`An unknown error occurred.`);
      }
      // Abort installation if error occurs.
      process.exit(1);
    }
  }
}

/**
 * Installs a single package and of all of its sub-dependencies by its identifier.
 * @param packageIdentifier The package identifier (<packageName>@<exactVersion>) to
 * uniquely identify the package, e.g. "semver@7.6.2".
 * It recursively installs all sub-dependencies of the package first before installing
 * the package itself. Therefore, this is effecively using DFS-based topological sort.
 * @param graph The dependency graph.
 * @param installed Set of already installed package identifiers to avoid re-processing.
 * @throws Error if the package couldn't be found in the dependency graph.
 */
async function installPackage(
  packageIdentifier: string,
  graph: DependencyGraph,
  installed: Set<string>,
): Promise<void> {
  // Skip processing if package has already been installed.
  if (installed.has(packageIdentifier)) {
    console.log(`Package ${packageIdentifier} already installed, skipping.`);
    return;
  }

  // Retrieve package information from the dependency graph.
  const packageInfo = graph[packageIdentifier];
  if (!packageInfo) {
    throw new Error(`Package ${packageIdentifier} not found in the graph.`);
  }

  // Recursively install all sub-dependencies of the package first.
  for (const dependency of packageInfo.dependencies) {
    await installPackage(dependency, graph, installed);
  }

  // Prepare the directory where the package will be installed.
  const [packageName] = parsePackageIdentifier(packageIdentifier);
  const packageDir = await preparePackageDirectory(packageName);
  // Convert '/' to '-' so we can properly write to filesystem.
  const tarFilename = `${packageName.replace("/", "-")}-${packageInfo.version}.tgz`;
  const cacheTarPath = path.join(CACHE_PATH, tarFilename);

  // Retrieve the tarball for the package, either by reading from the
  // cache or fetching from the NPM registry.
  const [tarData, isTarCached] = await retrieveTarball(
    packageName,
    packageInfo,
    cacheTarPath,
  );
  // Validate, cache, and extract the tarball into the prepared package
  // directory as appropriate.
  await extractTarball(
    packageName,
    packageInfo,
    cacheTarPath,
    tarData,
    isTarCached,
    packageDir,
  );

  // Mark the package as installed.
  installed.add(packageIdentifier);
}

/**
 * Prepares a package's directory for installation. Determines the appropriate
 * directory path, creates it if it doesn't exist, and returns the resolved path.
 * @param packageName Name of package to resolve.
 * @returns Promise of the directory path where the package will be installed.
 * @throws Error if directory couldn't be prepared due to invalid package name.
 */
async function preparePackageDirectory(packageName: string): Promise<string> {
  // If the package is a scoped directory, e.g. "@tsconfig/node10@1.0.11", the
  // package directory should include the scoped part. For normal packages,
  // just use the NODE_MODULES_PATH as normal.
  const scopedDir = packageName.startsWith("@")
    ? path.join(NODE_MODULES_PATH, packageName.split("/")[0])
    : NODE_MODULES_PATH;
  // Split the package name to handle nested directories for scoped packages.
  // This is necessary because scoped packages include both the scope and
  // package name.
  const packageDirsSplit = packageName.split("/");
  if (packageDirsSplit.length === 0) {
    throw new Error(`Dependency name ${packageName} is invalid.`);
  }
  // Pop the last element, which is the actual package name, to get the final
  // directory name where the package will be installed.
  const packageDir = path.join(scopedDir, packageDirsSplit.pop() as string);
  // Create package directory if it doesn't exist.
  const packageDirExists = await checkPathExists(packageDir);
  if (!packageDirExists) {
    await fs.mkdir(packageDir, { recursive: true });
  }

  return packageDir;
}

/**
 * Retrieves the data of the tarball. If cached, simply reads from the cache.
 * Otherwise, fetches it from NPM registry.
 * @param packageName Name of package to retrieve tarball data.
 * @param packageInfo Info about the package including its version and URL to
 * fetch the tarball.
 * @param cacheTarPath Path where tarball is or should be cached.
 * @returns Promise of a tuple containing tarball data as a Buffer, and
 * boolean indicating whether it was retrieved from cache.
 */
async function retrieveTarball(
  packageName: string,
  packageInfo: PackageInfo,
  cacheTarPath: string,
): Promise<[Buffer, boolean]> {
  const isTarCached = await checkPathExists(cacheTarPath);

  if (isTarCached) {
    // The tarball is already stored in cache, so retrieve it.
    console.log(
      `Using cached tarball for ${packageName}@${packageInfo.version}`,
    );
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

/**
 * Handles validating, caching, and extracting tarballs.
 * 1. Validates tarball's computed hash with expected hash. If invalid,
 *    removes tarball from cache.
 * 2. If valid, saves tarball to cache (if it wasn't already cached).
 * 3. Extracts tarball into specified package directory.
 * @param packageName Name of package to
 * @param packageInfo Info about the package including its version and hash.
 * @param cacheTarPath Path where tarball is or should be cached.
 * @param tarData Data of the tarball to validate.
 * @param isTarCached Whether the tarball was retrieved from cache.
 * @param packageDir Package directory where tarball should be extracted.
 * @throws Error if tarball was invalid (hash mismatch), indicating tampering
 * or corruption.
 */
async function extractTarball(
  packageName: string,
  packageInfo: PackageInfo,
  cacheTarPath: string,
  tarData: Buffer,
  isTarCached: boolean,
  packageDir: string,
): Promise<void> {
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
    throw new Error(
      `Validation failed for ${packageName}@${packageInfo.version}`,
    );
  }
}
