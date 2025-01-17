import path from "path";

// The URL for the NPM registry.
export const REGISTRY_URL = "https://registry.npmjs.org";

// Base directory for output.
export const BASE_OUTPUT_DIR = path.join(process.cwd(), "output");
// Default path for package.json.
export const PACKAGE_JSON_PATH = path.join(BASE_OUTPUT_DIR, "package.json");
// Default path for node_modules directory.
export const NODE_MODULES_PATH = path.join(BASE_OUTPUT_DIR, "node_modules");
// Default path for package manager's cache.
export const CACHE_PATH = path.join(BASE_OUTPUT_DIR, ".cache");
// Default path for package manager's lock file.
export const LOCK_PATH = path.join(BASE_OUTPUT_DIR, "package-lock.json");
