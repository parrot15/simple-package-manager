import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import semver from "semver";
import crypto from 'crypto';
import { LOCK_PATH, NODE_MODULES_PATH } from "./constants";
import { ensureOutputDirectoryExists, getPackageJson } from "./utils";
import { addPackage } from "./add";

interface DependencyGraph {
  [packageName: string]: {
    version: string;
    tarballUrl: string;
    hash: string;
    dependencies: DependencyGraph;
  };
}

async function resolveVersion(packageName: string, versionRange: string): Promise<string> {
  const registryUrl = `https://registry.npmjs.org/${packageName}`;
  try {
    const response = await axios.get(registryUrl);
    if (versionRange === "latest") {
      const latestVersion = response.data["dist-tags"].latest;
      return latestVersion;
    }
    const versions = Object.keys(response.data.versions);
    const validVersion = semver.maxSatisfying(versions, versionRange);
    if (!validVersion) {
      throw new Error(`No matching version found for ${packageName}@${versionRange}`);
    }
    return validVersion;
  } catch (error) {
    console.error(`Error resolving version for ${packageName}@${versionRange}: ${error}`);
    throw error;
  }
}

async function buildDependencyGraph(packageName: string, version: string): Promise<DependencyGraph> {
  const resolvedVersion = await resolveVersion(packageName, version);
  const registryUrl = `https://registry.npmjs.org/${packageName}/${resolvedVersion}`;
  console.log(`Fetching info for: ${registryUrl}`);
  const response = await axios.get(registryUrl);

  const packageVersion = response.data.version;
  const dependencies = response.data.dependencies || {};
  const tarballUrl = response.data.dist.tarball;
  const hash = response.data.dist.integrity;
  const graph: DependencyGraph = {
    [packageName]: {
      version: packageVersion,
      tarballUrl: tarballUrl,
      hash: hash,
      dependencies: {},
    },
  };

  // Gather all dependency promises.
  const dependencyPromises = Object.entries(dependencies).map(([depName, depVersion]) =>
    buildDependencyGraph(depName, depVersion as string)
  );

  // Resolve all dependency promises in parallel for efficiency.
  const resolvedDependencies = await Promise.all(dependencyPromises);
  resolvedDependencies.forEach((depGraph, index) => {
    const depName = Object.keys(dependencies)[index];
    graph[packageName].dependencies[depName] = depGraph[depName];
  });

  return graph;
}

async function installFromGraph(graph: DependencyGraph, basePath: string = NODE_MODULES_PATH): Promise<void> {
  for (const [packageName, packageDetails] of Object.entries(graph)) {
    try {
      const scopedDir = packageName.startsWith('@') ? path.join(NODE_MODULES_PATH, packageName.split('/')[0]) : NODE_MODULES_PATH;
      const packageDirsSplit = packageName.split('/');
      if (packageDirsSplit && packageDirsSplit.length === 0) {
        throw new Error(`Dependency name ${packageName} is invalid.`);
      }
      const packageDir = path.join(scopedDir, packageDirsSplit.pop() as string);
      if (!fs.existsSync(packageDir)) {
        fs.mkdirSync(packageDir, { recursive: true });
      }

      console.log(`Downloading tarball from: ${packageDetails.tarballUrl}`);
      const tarballResponse = await axios.get(packageDetails.tarballUrl, { responseType: "arraybuffer" });
      const tarPath = path.join(packageDir, `${packageName.replace('/', '-')}-${packageDetails.version}.tgz`);
      console.log(`Writing to ${tarPath}`);
      fs.writeFileSync(tarPath, tarballResponse.data);
      console.log(`Saved ${packageName}@${packageDetails.version}`);

      const isPackageValid = validatePackage(tarPath, packageDetails.hash);
      if (isPackageValid) {
        // The hashes matched - validation suceeded.
        console.log(`Validation succeeded for ${packageName}@${packageDetails.version}`);
        // Extract tarball.
        execSync(`tar -xzf ${tarPath} -C ${packageDir} --strip-components=1`);
        console.log(`Extracted ${packageName}@${packageDetails.version}`);
        // Remove tar file after extraction.
        fs.unlinkSync(tarPath);
        // Continue traversing dependency graph.
        await installFromGraph(packageDetails.dependencies, packageDir);
      } else {
        // The hashes do not match - validation failed.
        // Remove corrupted tar file.
        fs.unlinkSync(tarPath);
        throw new Error(`Validation failed for ${packageName}@${packageDetails.version}`);
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const errorMessage = `Failed to install ${packageName}@${packageDetails.version}: ${error.message}`;
        console.error(errorMessage);
        if (error.response) {
          console.error(`HTTP status: ${error.response.status}. ${error.response.statusText}`);
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

async function didDependenciesChange(packageJsonDependencies: Record<string, string>, lockGraph: DependencyGraph): Promise<boolean> {
  for (const [pkg, versionRange] of Object.entries(packageJsonDependencies)) {
    if (!lockGraph[pkg]) {
      // A new dependency was added.
      return true;
    }
    const lockedVersion = lockGraph[pkg].version;
    if (!semver.satisfies(lockedVersion, versionRange)) {
      // A dependency version changed.
      return true;
    }
  }

  for (const pkg of Object.keys(lockGraph)) {
    // if (!Object.keys(packageJsonDependencies).includes(pkg)) {
    if (!packageJsonDependencies.hasOwnProperty(pkg)) {
      // A dependency was removed.
      return true;
    }
  }

  return false;
}

function validatePackage(tarPath: string, expectedHash: string): boolean {
  const fileBuffer = fs.readFileSync(tarPath);

  // Extract the hash algorithm and the hash value.
  const [algorithm, base64Hash] = expectedHash.split('-');
  const actualHash = crypto.createHash(algorithm)
    .update(fileBuffer)
    .digest('base64');

  return actualHash === base64Hash;
}

async function installPackages(): Promise<void> {
  const packageJson = getPackageJson();
  const dependencies = packageJson.dependencies;
  console.log(`dependencies: ${JSON.stringify(dependencies, null, 2)}`);

  const lockGraph: DependencyGraph | null = await readLockFile();
  if (lockGraph) {
    // The lock file exists, so check package.json's dependencies
    // against the lock file's graph.
    const dependenciesChanged = await didDependenciesChange(dependencies, lockGraph);
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

  // No lock file or dependencies changed, so do fresh install of
  // all packages.
  if (!fs.existsSync(NODE_MODULES_PATH)) {
    fs.mkdirSync(NODE_MODULES_PATH);
  }

  console.log("----- Building dependency graph -----");
  let fullGraph: DependencyGraph = {};
  for (const [pkg, version] of Object.entries(dependencies)) {
    const graph = await buildDependencyGraph(pkg, version);
    fullGraph = { ...fullGraph, ...graph };
  }

  console.log("----- Installing dependencies -----");
  await installFromGraph(fullGraph);
  await saveLockFile(fullGraph);
}

async function saveLockFile(graph: DependencyGraph): Promise<void> {
  const lockFilePath = path.join(LOCK_PATH);
  // Lock file is just the entire dependency graph serialized into JSON.
  await writeFile(lockFilePath, JSON.stringify(graph, null, 2));
  console.log(`Lock file saved at ${lockFilePath}`);
}

async function readLockFile(): Promise<DependencyGraph | null> {
  if (fs.existsSync(LOCK_PATH)) {
    const fileContents = await readFile(LOCK_PATH, 'utf8');
    return JSON.parse(fileContents);
  }
  return null;
}

// Command line argument processing.
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const command = args[0];
    const packageInfo = args[1];
  
    switch (command) {
      case "add":
        if (!packageInfo || args.length !== 2) {
          console.log("Usage: node package-manager.js add <package_name>@<version>");
          process.exit(1);
        }
        ensureOutputDirectoryExists();
        addPackage(packageInfo);
        break;
      case "install":
        ensureOutputDirectoryExists();
        installPackages();
        break;
      default:
        console.log("Available commands: add, install");
        break;
    }
  } else {
    console.log("Usage: node package-manager.js <command> [arguments]");
  }
}

main().catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
})
