import fs from "fs/promises";
import crypto from "crypto";
import semver from "semver";
import axios from "axios";
import { packageInfoCache, packageVersionCache } from "./globals";
import {
  BASE_OUTPUT_DIR,
  PACKAGE_JSON_PATH,
  NODE_MODULES_PATH,
  LOCK_PATH,
  CACHE_PATH,
  REGISTRY_URL,
} from "./constants";
import { PackageInfo, PackageJson, DependencyGraph } from "./types";

/**
 * Checks if a path exists in the file system.
 * @param path The file or directory path to check.
 * @returns Promise of true if path exists, or false otherwise.
 */
export async function checkPathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    // We successfully accessed the file, so it exists.
    return true;
  } catch {
    // We failed to access, so it doesn't exist.
    return false;
  }
}

/**
 * Ensures that the necessary 'output', 'output/node_modules', and
 * 'output/.cache' exist.
 */
export async function ensureOutputDirectoriesExist(): Promise<void> {
  // Create base output folder if it doesn't exist.
  const baseOutputDirExists = await checkPathExists(BASE_OUTPUT_DIR);
  if (!baseOutputDirExists) {
    console.log(`'output' directory does not exist. Creating...`);
    await fs.mkdir(BASE_OUTPUT_DIR, { recursive: true });
  }

  // Create node_modules packages folder if it doesn't exist.
  const nodeModulesExists = await checkPathExists(NODE_MODULES_PATH);
  if (!nodeModulesExists) {
    console.log(`'node_modules' directory does not exist. Creating...`);
    await fs.mkdir(NODE_MODULES_PATH, { recursive: true });
  }

  // Create .cache caching folder if it doesn't exist.
  const cacheExists = await checkPathExists(CACHE_PATH);
  if (!cacheExists) {
    console.log(`'.cache' directory does not exist. Creating...`);
    await fs.mkdir(CACHE_PATH, { recursive: true });
  }
}

/**
 * Retrieves the package.json data. Exits if package.json doesn't exist.
 * @returns Promise of parsed package.json object.
 */
export async function getPackageJson(): Promise<PackageJson> {
  const packageJsonExists = checkPathExists(PACKAGE_JSON_PATH);
  if (!packageJsonExists) {
    console.error(
      "package.json does not exist in the output directory. Please create it.",
    );
    process.exit(1);
  }

  const packageJson = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, "utf-8"));
  return packageJson;
}

/**
 * Saves the lock file for deterministic package installation. The lock
 * file is merely just the dependency graph serialized and dumped into
 * a file.
 * @param graph Dependency graph to save into lock file.
 */
export async function saveLockFile(graph: DependencyGraph): Promise<void> {
  // Lock file is just the entire dependency graph serialized into JSON.
  await fs.writeFile(LOCK_PATH, JSON.stringify(graph, null, 2));
  console.log(`Lock file saved at ${LOCK_PATH}`);
}

/**
 * Read the dependency graph from the lock file.
 * @returns Promise of the dependency graph if it exists, otherwise null.
 */
export async function readLockFile(): Promise<DependencyGraph | null> {
  const lockFileExists = await checkPathExists(LOCK_PATH);
  if (lockFileExists) {
    const fileContents = await fs.readFile(LOCK_PATH, "utf8");
    return JSON.parse(fileContents);
  }
  return null;
}

/**
 * Resolves the exact version of a package given a version range. For
 * example, a version range would be ^7.6.2 (semver notation). This would
 * be resolved to an exact version, e.g. 7.6.2.
 * If the version range is 'latest', then just fetches the latest version
 * from the registry.
 * @param packageName Name of the package to resolve the version of.
 * @param versionRange The version range to resolve.
 * @returns Promise of the exact version of the package.
 * @throws Error if the version couldn't be resolved.
 */
export async function resolveVersion(
  packageName: string,
  versionRange: string,
): Promise<string> {
  const cacheKey = `${packageName}@${versionRange}`;

  // Check if the resolved version is already in the cache.
  if (packageVersionCache.has(cacheKey)) {
    console.log(`Retrieving version info ${cacheKey} from cache.`);
    return packageVersionCache.get(cacheKey) as string;
  }

  try {
    // Fetch version data from the NPM registry.
    const registryUrl = `${REGISTRY_URL}/${packageName}`;
    console.log(`Fetching version info for ${registryUrl}.`);
    const response = await axios.get(registryUrl);

    // If the version range was specified as 'latest', directly look
    // up the latest version.
    if (versionRange === "latest") {
      const latestVersion = response.data["dist-tags"].latest;
      packageVersionCache.set(cacheKey, latestVersion);
      return latestVersion;
    }

    // Resolve the maximum satisfying version among all available versions.
    const versions = Object.keys(response.data.versions);
    const validVersion = semver.maxSatisfying(versions, versionRange);
    if (!validVersion) {
      throw new Error(
        `No matching version found for ${packageName}@${versionRange}`,
      );
    }

    // Cache the resolved version for future requests.
    packageVersionCache.set(cacheKey, validVersion);
    return validVersion;
  } catch (error) {
    console.error(
      `Error resolving version for ${packageName}@${versionRange}: ${error}`,
    );
    throw error;
  }
}

/**
 * Retrieves detailed information about a package, such as its SHA-512 hash,
 * sub-dependencies, URL to fetch the tarball, etc.
 * @param packageName The name of the package.
 * @param exactVersion The exact version of the package.
 * @returns Promise of a PackageInfo object populated with the package's
 * information.
 * @throws Throws an error if the package info couldn't be retrieved.
 */
export async function getPackageInfo(
  packageName: string,
  exactVersion: string,
): Promise<PackageInfo> {
  const packageIdentifier = `${packageName}@${exactVersion}`;

  // Check if the package info is already in the cache.
  if (packageInfoCache.has(packageIdentifier)) {
    console.log(`Retrieving package info ${packageIdentifier} from cache.`);
    return packageInfoCache.get(packageIdentifier) as PackageInfo;
  }

  try {
    // Fetch package metadata from NPM registry.
    const registryUrl = `${REGISTRY_URL}/${packageName}/${exactVersion}`;
    console.log(`Fetching package info for ${registryUrl}.`);
    const response = await axios.get(registryUrl);

    // Construct an initial PackageInfo object.
    const packageInfo: PackageInfo = {
      version: response.data.version,
      tarballUrl: response.data.dist.tarball,
      hash: response.data.dist.integrity,
      isDirectDependency: false, // Default value of false, can be overridden.
      dependencies: [], // Default value of empty, can be overridden.
    };

    // Process dependencies, if any are listed.
    const dependencyVersionRanges = response.data.dependencies || {};
    // Resolve each dependency's version range to its exact version.
    const dependencyIdentifiers = await Promise.all(
      Object.entries(dependencyVersionRanges).map(
        async ([depName, depVersionRange]) => {
          const exactVersion = await resolveVersion(
            depName,
            depVersionRange as string,
          );
          // Return in standard packageIdentifier format.
          return `${depName}@${exactVersion}`;
        },
      ),
    );
    // Update package info with dependencies having exact versions.
    packageInfo.dependencies = dependencyIdentifiers;

    // Cache the package info for future requests.
    packageInfoCache.set(packageIdentifier, packageInfo);
    return packageInfo;
  } catch (error) {
    console.error(
      `Error resolving package info for ${packageIdentifier}: ${error}.`,
    );
    throw error;
  }
}

/**
 * Parses a package identifier into its name and exact version components.
 * A package identifier follows the format "<packageName>@<exactVersion>".
 * For example, a package identifier could be "semver@7.6.2".
 * There is a bit more logic involved than just splitting on the '@' symbol
 * because we could have scoped packages, e.g. "@jridgewell/resolve-uri@3.1.2".
 * @param packageIdentifier The full package identifier string.
 * @returns Tuple containing package name and exact version.
 */
export function parsePackageIdentifier(
  packageIdentifier: string,
): [string, string] {
  // Find index of last '@' character which separates package name and version.
  const atIndex = packageIdentifier.lastIndexOf("@");
  // Get packageName by substringing up to index.
  const packageName = packageIdentifier.substring(0, atIndex);
  // Get packageName by substringing after index.
  const packageVersion = packageIdentifier.substring(atIndex + 1);
  return [packageName, packageVersion];
}

/**
 * Compares the hash of a given file's data against its expected hash value.
 * This is used to validate tarballs from the NPM registry and .cache directory
 * and make sure they haven't been tampered with.
 * @param fileData Data of the file to generate the hash for.
 * @param expectedHash Expected hash to compare the generated hash against.
 * @returns True if hashes match, false otherwise.
 */
export function doesHashMatch(fileData: Buffer, expectedHash: string): boolean {
  // Extract the hash algorithm and the expected hash value to use.
  const [algorithm, base64Hash] = expectedHash.split("-");
  // Compute the actual hash.
  const actualHash = crypto
    .createHash(algorithm)
    .update(fileData)
    .digest("base64");
  // Do they match?
  return actualHash === base64Hash;
}
