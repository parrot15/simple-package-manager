import fs from "fs/promises";
import { PACKAGE_JSON_PATH } from "./constants";
import { getPackageJson } from "./utils";
import { PackageJson } from "./types";

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
