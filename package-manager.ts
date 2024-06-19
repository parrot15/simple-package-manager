import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import semver from "semver";
import { NODE_MODULES_PATH } from "./constants";
import { ensureOutputDirectoryExists, getPackageJson } from "./utils";
import { addPackage } from "./add";

interface DependencyGraph {
  [packageName: string]: {
    version: string;
    tarballUrl: string;
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
  const graph: DependencyGraph = {
    [packageName]: {
      // version: resolvedVersion,
      version: packageVersion,
      tarballUrl: tarballUrl,
      dependencies: {},
    },
  };

  for (const [depName, depVersion] of Object.entries(dependencies)) {
    const depGraph = await buildDependencyGraph(depName, depVersion as string);
    graph[packageName].dependencies[depName] = depGraph[depName];
  }

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
      console.log(`Downloaded and saved ${packageName}@${packageDetails.version}`);

      // Extract tarball.
      execSync(`tar -xzf ${tarPath} -C ${packageDir} --strip-components=1`);
      fs.unlinkSync(tarPath);  // Remove tar file after extraction.

      await installFromGraph(packageDetails.dependencies, packageDir);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const errorMessage = `Failed to install ${packageName}@${packageDetails.version}: ${error.message}`;
        console.error(errorMessage);
        if (error.response) {
          console.error(`HTTP status: ${error.response.status}. ${error.response.statusText}`);
        }
      } else if (error instanceof Error) {
        console.error(`Unexpected error: ${error.message}`);
      } else {
        console.error(`An unknown error occurred`);
      }
    }
  }
}

async function installPackages(): Promise<void> {
  const packageJson = getPackageJson();
  const dependencies = packageJson.dependencies;
  console.log(`dependencies: ${JSON.stringify(dependencies, null, 2)}`);

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
}

// Command line argument processing
const args = process.argv.slice(2);
if (args.length > 0) {
  const command = args[0];
  const packageInfo = args[1];

  switch (command) {
    case "add":
      if (!packageInfo || args.length !== 2) {
        console.log(
          "Usage: ts-node package-manager.ts add <package_name>@<version>",
        );
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
  console.log("Usage: ts-node package-manager.ts <command> [arguments]");
}
