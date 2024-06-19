import fs from "fs/promises";
import { PACKAGE_JSON_PATH } from "./constants";
import { getPackageJson } from "./utils";
import { PackageJson } from "./types";

/**
 * Adds a package and its version to the package.json dependencies.
 * @param packageInfo The package information in the format
 * "<packageName>@<versionRange>." If version is omitted, defaults
 * to "latest".
 * @returns Promise that resolves when package has been added to
 * package.json.
 */
export async function addPackage(packageInfo: string): Promise<void> {
  // Split the inputted package information into package name and
  // version range. If no '@', version range defaults to 'latest.
  const [packageName, versionRange] = packageInfo.includes("@")
    ? packageInfo.split("@")
    : [packageInfo, "latest"];

  // Retrieve the current package.json content.
  const packageJson: PackageJson = await getPackageJson();
  // Ensure the dependencies object exists.
  packageJson.dependencies = packageJson.dependencies || {};
  // Add or update the dependencies.
  packageJson.dependencies[packageName] = versionRange;

  // Write the updated package.json back to the filesystem.
  await fs.writeFile(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName}@${versionRange} to package.json`);
}
