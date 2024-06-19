import { ensureOutputDirectoriesExist } from "./utils";
import { addPackage } from "./add";
import { determinePackageInstallation } from "./install";

/**
 * Entry point for the package manager CLI. Processes 'add' and
 * 'install' commands.
 */
async function main(): Promise<void> {
  // Extract command line arguments, ignoring the first two (node and script path).
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const command = args[0];
    const packageInfo = args[1];

    switch (command) {
      case "add":
        // Validate the required 'add' command arguments.
        if (!packageInfo || args.length !== 2) {
          console.log(
            "Usage: node package-manager.js add <package_name>@<version>",
          );
          process.exit(1);
        }
        // Ensure necessary directories are present.
        await ensureOutputDirectoriesExist();
        await addPackage(packageInfo);
        break;
      case "install":
        // Start timing the package installation process.
        console.time("Total time taken");
        // Ensure necessary directories are present.
        await ensureOutputDirectoriesExist();
        await determinePackageInstallation();
        // End and print the elapsed time.
        console.timeEnd("Total time taken");
        break;
      default:
        console.log("Available commands: add, install");
        break;
    }
  } else {
    // Handle unknown command.
    console.log("Usage: node package-manager.js <command> [arguments]");
  }
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
