#!/usr/bin/env node
import { Command } from "commander";
import { Application, ApplicationOptions } from ".";
interface CLIOptions {
  dryRun?: boolean;
  verbose?: boolean;
  skipValidation?: boolean;
  mode?: "convert" | "monitor" | "health";
  progress?: boolean;
}
export class CLI {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  setupCommands() {
    // Health check command
    this.program
      .command("health")
      .description("Check service health and configuration")
      .option("-v, --verbose", "Enable verbose logging", false)
      .action(async (options: CLIOptions) => {
        await this.runHealthCheck(options);
      });

    // Convert command
    this.program
      .command("convert")
      .description("Convert all images in S3 bucket to WebP format")
      .option("-d, --dry-run", "Run without actually converting images", false)
      .option("-v, --verbose", "Enable verbose logging", false)
      .option("--skip-validation", "Skip startup validation checks", false)
      .option("-p, --progress", "Show detailed progress reporting", true)
      .action(async (options: CLIOptions) => {
        await this.runConversion(options);
      });
  }

  private async runHealthCheck(options: CLIOptions): Promise<void> {
    console.log("🏥 Running health check...\n");

    try {
      const appOptions: ApplicationOptions = {
        verbose: options.verbose || false,
        skipValidation: false, // Always validate for health check
      };

      const app = new Application(appOptions);
      const config = app.getConfig();

      console.log("✅ Configuration loaded successfully");
      console.log(`📁 Target bucket: ${config.aws.targetBucket}`);
      console.log(`🌍 AWS region: ${config.aws.region}`);
      console.log(`🎨 WebP quality: ${config.conversion.quality}`);
      console.log(`⚡ Concurrency: ${config.processing.concurrency}`);

      console.log("\n🔍 Validating AWS permissions...");
      // Validation happens in constructor, so if we get here, it passed
      console.log("✅ AWS permissions validated");

      console.log("\n✅ Health check completed successfully");
    } catch (error) {
      console.error(
        "❌ Health check failed:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }
  private async runConversion(options: CLIOptions): Promise<void> {
    console.log(`🚀 Starting S3 Image WebP Converter... \n`);

    try {
      const appOptions: ApplicationOptions = {
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        skipValidation: options.skipValidation || false,
      };

      const app = new Application(appOptions);

      // Start service
      await app.start();

      // Run conversion
      await app.runConversion(appOptions);
      
      console.log("\n✅ Image conversion process completed successfully");
      // Shutdown gracefully
      await app.shutdown();
    } catch (error) {
      console.error(
        "❌ Conversion failed:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }
  async run(): Promise<void> {
    await this.program.parseAsync(process.argv);
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  const cli = new CLI();
  cli.run().catch((error) => {
    console.error("CLI Error:", error);
    process.exit(1);
  });
}

// Main function for programmatic usage
export async function main(args?: string[]): Promise<void> {
  const cli = new CLI();

  if (args) {
    // Override process.argv for testing
    const originalArgv = process.argv;
    process.argv = ["node", "cli.js", ...args];

    try {
      await cli.run();
    } finally {
      process.argv = originalArgv;
    }
  } else {
    await cli.run();
  }
}
