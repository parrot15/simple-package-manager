import path from "path";

// Base directory for output.
export const BASE_OUTPUT_DIR = path.join(process.cwd(), "output");
// Default path for package.json.
export const PACKAGE_JSON_PATH = path.join(BASE_OUTPUT_DIR, "package.json");
// Default path for node_modules directory.
export const NODE_MODULES_PATH = path.join(BASE_OUTPUT_DIR, "node_modules");
