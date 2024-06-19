import fs from "fs/promises";
import { PACKAGE_JSON_PATH } from "./constants";
import { getPackageJson } from "./utils";
import { PackageJson } from "./types";

/**
 * Adds a package and its version to the package.json dependencies.
 * @param packageInfo The package information in the format
 * "<packageName>@<versionRange>." If version is omitted,
 * defaults to "latest".
 * @returns Promise that resolves when package has been added
 * to package.json.
 */
export async function addPackage(packageInfo: string): Promise<void> {
  const [packageName, version] = packageInfo.includes("@")
    ? packageInfo.split("@")
    : [packageInfo, "latest"];

  const packageJson: PackageJson = await getPackageJson();
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies[packageName] = version;

  await fs.writeFile(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName}@${version} to package.json`);
}
