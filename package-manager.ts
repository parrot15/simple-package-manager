import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import semver from "semver";

interface PackageJson {
  dependencies: Record<string, string>;
}

// Add a package to package.json
function addPackage(packageName: string, version: string = "latest"): void {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageJson: PackageJson = JSON.parse(
    fs.readFileSync(packagePath, "utf-8"),
  );

  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies[packageName] = version;

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName}@${version} to package.json`);
}

async function resolveVersion(packageName: string, versionRange: string): Promise<string> {
  const registryUrl = `https://registry.npmjs.org/${packageName}`;
  try {
    const response = await axios.get(registryUrl);
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

// Recursively install packages and their dependencies
async function installPackage(
  packageName: string,
  version: string,
  nodeModulesPath: string,
): Promise<void> {
  const resolvedVersion = await resolveVersion(packageName, version);
  const url = `https://registry.npmjs.org/${packageName}/${resolvedVersion}`;
  console.log(`Attempting to download: ${url}`);

  try {
    const response = await axios.get(url);
    const tarballUrl = response.data.dist.tarball;
    console.log(`Downloading tarball from: ${tarballUrl}`);

    const tarballResponse = await axios.get(tarballUrl, {
      responseType: "arraybuffer",
    });
    const tarPath = path.join(nodeModulesPath, `${packageName}-${resolvedVersion}.tgz`);
    fs.writeFileSync(tarPath, tarballResponse.data);
    console.log(`Downloaded and saved ${packageName}@${resolvedVersion}`);

    // Extract tarball
    execSync(`tar -xzf ${tarPath} -C ${nodeModulesPath}`);
    fs.unlinkSync(tarPath); // Remove tar file after extraction

    const dependencies = response.data.dependencies || {};
    // Install each dependency
    for (const [depName, depVersion] of Object.entries(dependencies)) {
      await installPackage(depName as string, depVersion as string, nodeModulesPath);
    }
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const errorMessage = `Failed to install ${packageName}@${resolvedVersion}: ${error.message}`;
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

// Install all packages listed in package.json
async function installPackages(): Promise<void> {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageJson: PackageJson = JSON.parse(
    fs.readFileSync(packagePath, "utf-8"),
  );
  const dependencies = packageJson.dependencies;
  console.log(`dependencies: ${JSON.stringify(dependencies, null, 2)}`);

  const nodeModulesPath = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    fs.mkdirSync(nodeModulesPath);
  }

  for (const [pkg, version] of Object.entries(dependencies)) {
    await installPackage(pkg, version, nodeModulesPath);
  }
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
      const [packageName, version] = packageInfo.includes("@")
        ? packageInfo.split("@")
        : [packageInfo, "latest"];
      addPackage(packageName, version);
      break;
    case "install":
      installPackages();
      break;
    default:
      console.log("Available commands: add, install");
      break;
  }
} else {
  console.log("Usage: ts-node package-manager.ts <command> [arguments]");
}
