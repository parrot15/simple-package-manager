import fs from "fs/promises";
import crypto from "crypto";
import semver from "semver";
import axios from "axios";
import { packageInfoCache, packageVersionCache } from "./globals";
import {
  BASE_OUTPUT_DIR,
  PACKAGE_JSON_PATH,
  NODE_MODULES_PATH,
  CACHE_PATH,
  REGISTRY_URL,
} from "./constants";
import { PackageInfo, PackageJson } from "./types";
// import { PackageInfo } from "./graph";

export async function checkPathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

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

export async function resolveVersion(
  packageName: string,
  versionRange: string,
): Promise<string> {
  // If we've already looked up this package name and version range before,
  // just return from cache.
  const cacheKey = `${packageName}@${versionRange}`;
  if (packageVersionCache.has(cacheKey)) {
    console.log(`Retrieving version info ${cacheKey} from cache.`);
    return packageVersionCache.get(cacheKey) as string;
  }
  // if (packageVersionCache[cacheKey]) {
  //   return packageVersionCache[cacheKey];
  // }

  const registryUrl = `${REGISTRY_URL}/${packageName}`;
  console.log(`Fetching version info for ${registryUrl}.`);
  try {
    const response = await axios.get(registryUrl);
    if (versionRange === "latest") {
      const latestVersion = response.data["dist-tags"].latest;
      // packageVersionCache[cacheKey] = latestVersion;
      packageVersionCache.set(cacheKey, latestVersion);
      return latestVersion;
    }
    const versions = Object.keys(response.data.versions);
    const validVersion = semver.maxSatisfying(versions, versionRange);
    if (!validVersion) {
      throw new Error(
        `No matching version found for ${packageName}@${versionRange}`,
      );
    }
    // packageVersionCache[cacheKey] = validVersion;
    packageVersionCache.set(cacheKey, validVersion);
    return validVersion;
  } catch (error) {
    console.error(
      `Error resolving version for ${packageName}@${versionRange}: ${error}`,
    );
    throw error;
  }
}

export async function getPackageInfo(packageName: string, exactVersion: string): Promise<PackageInfo> {
  const packageIdentifier = `${packageName}@${exactVersion}`;

  // Check if the package info is already in the cache.
  if (packageInfoCache.has(packageIdentifier)) {
    console.log(`Retrieving package info ${packageIdentifier} from cache.`);
    return packageInfoCache.get(packageIdentifier) as PackageInfo;
  }

  const registryUrl = `${REGISTRY_URL}/${packageName}/${exactVersion}`;
  console.log(`Fetching package info for ${registryUrl}.`);
  // const packageVersion = response.data.version;
  // // const packageIdentifier = `${packageName}@${packageVersion}`;
  // const dependencies = response.data.dependencies || {};
  // const tarballUrl = response.data.dist.tarball;
  // const hash = response.data.dist.integrity;
  try {
    const response = await axios.get(registryUrl);
    const packageInfo: PackageInfo = {
      version: response.data.version,
      tarballUrl: response.data.dist.tarball,
      hash: response.data.dist.integrity,
      isDirectDependency: false,  // Default value of false, can be overridden.
      // dependencies: [],  // Default value of empty, can be overriden.
      dependencies: response.data.dependencies,
    }
    packageInfoCache.set(packageIdentifier, packageInfo);
    return packageInfo;
  } catch (error) {
    console.error(`Error resolving package info for ${packageIdentifier}: ${error}.`);
    throw error;
  }
}

export function parsePackageIdentifier(packageIdentifier: string): [string, string] {
  const atIndex = packageIdentifier.lastIndexOf("@");
  const packageName = packageIdentifier.substring(0, atIndex);
  const packageVersion = packageIdentifier.substring(atIndex + 1);
  return [packageName, packageVersion];
}

export function doesHashMatch(fileData: Buffer, expectedHash: string): boolean {
  // Extract the hash algorithm and the hash value.
  const [algorithm, base64Hash] = expectedHash.split("-");
  const actualHash = crypto
    .createHash(algorithm)
    .update(fileData)
    .digest("base64");

  return actualHash === base64Hash;
}
