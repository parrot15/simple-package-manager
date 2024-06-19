import { ensureOutputDirectoriesExist } from "./utils";
import { addPackage } from "./add";
import { installPackages } from "./install";

// Command line argument processing.
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const command = args[0];
    const packageInfo = args[1];

    switch (command) {
      case "add":
        if (!packageInfo || args.length !== 2) {
          console.log(
            "Usage: node package-manager.js add <package_name>@<version>",
          );
          process.exit(1);
        }
        await ensureOutputDirectoriesExist();
        await addPackage(packageInfo);
        break;
      case "install":
        console.time("Total time taken");
        await ensureOutputDirectoriesExist();
        await installPackages();
        console.timeEnd("Total time taken");
        break;
      default:
        console.log("Available commands: add, install");
        break;
    }
  } else {
    console.log("Usage: node package-manager.js <command> [arguments]");
  }
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
