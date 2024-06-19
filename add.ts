import fs from "fs";
import { PACKAGE_JSON_PATH } from "./constants";
import { getPackageJson, PackageJson } from "./utils";

export function addPackage(packageInfo: string): void {
  const [packageName, version] = packageInfo.includes("@")
        ? packageInfo.split("@")
        : [packageInfo, "latest"];

  const packageJson: PackageJson = getPackageJson();
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies[packageName] = version;

  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName}@${version} to package.json`);
}