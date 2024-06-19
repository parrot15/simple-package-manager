import fs from "fs";
import { BASE_OUTPUT_DIR, PACKAGE_JSON_PATH } from "./constants";

export interface PackageJson {
  dependencies: Record<string, string>;
}

export function ensureOutputDirectoryExists(): void {
  if (!fs.existsSync(BASE_OUTPUT_DIR)) {
    console.log(`Output directory does not exist. Creating "${BASE_OUTPUT_DIR}"...`);
    fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
  }
}

export function getPackageJson(): PackageJson {
  if (!fs.existsSync(PACKAGE_JSON_PATH)) {
    console.error("package.json does not exist in the output directory. Please create it.");
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8"));
  return packageJson;
}