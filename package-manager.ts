import fs from "fs";
import path from "path";
import axios from "axios";

// Define a function to add a package to package.json
function addPackage(packageName: string, version: string = "latest"): void {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies[packageName] = version;

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`Added ${packageName}@${version} to package.json`);
}

// Define a function to install packages from package.json
async function installPackages(): Promise<void> {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
  const dependencies = packageJson.dependencies;

  const nodeModulesPath = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    fs.mkdirSync(nodeModulesPath);
  }

  for (const [pkg, version] of Object.entries(dependencies)) {
    try {
      const url = `https://registry.npmjs.org/${pkg}/${version}`;
      const response = await axios.get(url);
      const tarballUrl = response.data.dist.tarball;

      // Simplified download: just save the tarball URL in a text file
      const pkgPath = path.join(nodeModulesPath, `${pkg}.txt`);
      fs.writeFileSync(pkgPath, tarballUrl);
      console.log(`Installed ${pkg}@${version}`);
    } catch (error) {
      console.error(`Failed to install ${pkg}@${version}: ${error}`);
    }
  }
}

// Process command line arguments
const args = process.argv.slice(2);
if (args.length > 0) {
  const command = args[0];

  switch (command) {
    case "add":
      if (args.length !== 2) {
        console.log(
          "Usage: node package-manager.js add <package_name>@<version>",
        );
        process.exit(1);
      }
      const [packageName, version] = args[1].split("@");
      addPackage(packageName, version || "latest");
      break;
    case "install":
      installPackages();
      break;
    default:
      console.log("Available commands: add, install");
      break;
  }
} else {
  console.log("Usage: node package-manager.js <command>");
}
