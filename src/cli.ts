#!/usr/bin/env node
import { Command } from "commander";
import { Application, ApplicationOptions } from ".";
import ora from "ora";
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

    // History command
    this.program
      .command("history")
      .description("Show conversion history and statistics")
      .option("-v, --verbose", "Show detailed conversion records", false)
      .action(async (options: CLIOptions) => {
        await this.showConversionHistory(options);
      });

    // Clear history command
    this.program
      .command("clear-history")
      .description(
        "Clear conversion history (allows re-conversion of all images)"
      )
      .option("-y, --yes", "Skip confirmation prompt", false)
      .action(async (options: { yes?: boolean }) => {
        await this.clearConversionHistory(options);
      });

    // Mockup images to s3
    this.program
      .command("mock-image")
      .description("Mockup image to s3 100")
      .action(async (options: CLIOptions) => {
        await this.mockImage(options);
      });
  }

  private async runHealthCheck(options: CLIOptions): Promise<void> {
    const spinner = ora("🏥 Running health check...").start();
    try {
      const appOptions: ApplicationOptions = {
        verbose: options.verbose || false,
        skipValidation: false, // Always validate for health check
      };

      spinner.text = "📋 Loading configuration...";
      const app = new Application(appOptions);
      const config = app.getConfig();

      spinner.text = "🔍 Validating AWS permissions...";
      // Validation happens in constructor, so if we get here, it passed

      spinner.succeed("Health check completed successfully");

      console.log("\n� oSystem Status:");
      console.log(`   📁 Target bucket: ${config.aws.targetBucket}`);
      console.log(`   🌍 AWS region: ${config.aws.region}`);
      console.log(`   🎨 WebP quality: ${config.conversion.quality}`);
      console.log(`   🔑 AWS max keys: ${config.aws.maxKeys || 1000}`);
      console.log(
        `   🖼️  Supported formats: ${config.conversion.supportedFormats.join(
          ", "
        )}`
      );
      console.log(
        `   🖼️  Mockup image count: ${config.mockup?.imageCount || 0}`
      );
    } catch (error) {
      if (spinner) {
        spinner.fail("Health check failed");
      }
      console.error(
        "Error details:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }
  private async runConversion(options: CLIOptions): Promise<void> {
    const spinner = ora("🚀 Starting S3 Image WebP Converter...").start();
    try {
      const appOptions: ApplicationOptions = {
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        skipValidation: options.skipValidation || false,
      };

      if (spinner) {
        spinner.text = "📋 Loading configuration and validating...";
      }
      const app = new Application(appOptions);

      // Start service
      if (spinner) {
        spinner.text = "🔧 Starting application services...";
      }
      await app.start();

      // Run conversion
      if (spinner) {
        spinner.text = "🖼️  Processing images for conversion...";
      }
      const report = await app.runConversion(appOptions, (msg: string) => {
        if (spinner) {
          spinner.text = `🖼️  ${msg}`;
        }
      });

      if (spinner) {
        spinner.succeed("Image conversion process completed successfully");
      } else {
        console.log("✅ Image conversion process completed successfully");
      }
      console.info({
        operation: "report.summary",
        duration: report.processingDuration,
        successful: report.successful,
        failed: report.failed,
        skipped: report.skipped,
        totalImages: report.totalImages,
      });
      // Shutdown gracefully
      await app.shutdown();
    } catch (error) {
      if (spinner) {
        spinner.fail("Conversion failed");
      }
      console.error(
        "Error details:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }

  private async showConversionHistory(options: CLIOptions): Promise<void> {
    console.log("📊 Conversion History\n");

    try {
      const { FileBasedConversionTracker } = await import(
        "./services/conversionTracker"
      );
      const tracker = new FileBasedConversionTracker();

      // Load the tracking data
      await tracker.loadConvertedKeys();
      const convertedKeys = await tracker.getConvertedKeys();

      if (convertedKeys.size === 0) {
        console.log(
          "No conversion history found. No images have been converted yet."
        );
        return;
      }

      console.log(`📈 Total converted images: ${convertedKeys.size}\n`);

      if (options.verbose) {
        // Read the detailed records from the tracking file
        const fs = await import("fs/promises");
        try {
          const data = await fs.readFile("logs/converted-images.json", "utf-8");
          const records = JSON.parse(data);

          console.log("🔍 Detailed conversion records:\n");
          records.forEach((record: any, index: number) => {
            const sizeSavedKB = (
              (record.originalSize - record.convertedSize) /
              1024
            ).toFixed(1);
            const compressionPercent = (record.compressionRatio * 100).toFixed(
              1
            );

            console.log(`${index + 1}. ${record.sourceKey}`);
            console.log(`   → ${record.targetKey}`);
            console.log(
              `   📅 Converted: ${new Date(
                record.convertedAt
              ).toLocaleString()}`
            );
            console.log(
              `   📊 Size: ${(record.originalSize / 1024).toFixed(1)}KB → ${(
                record.convertedSize / 1024
              ).toFixed(
                1
              )}KB (saved ${sizeSavedKB}KB, ${compressionPercent}% compression)`
            );
            console.log("");
          });
        } catch (error) {
          console.log("Converted images:");
          Array.from(convertedKeys).forEach((key, index) => {
            console.log(`${index + 1}. ${key}`);
          });
        }
      } else {
        console.log("Recently converted images:");
        Array.from(convertedKeys)
          .slice(-10)
          .forEach((key, index) => {
            console.log(`${index + 1}. ${key}`);
          });

        if (convertedKeys.size > 10) {
          console.log(`... and ${convertedKeys.size - 10} more images`);
        }
        console.log("\nUse --verbose flag to see detailed conversion records");
      }
    } catch (error) {
      console.error(
        "❌ Failed to load conversion history:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }

  private async clearConversionHistory(options: {
    yes?: boolean;
  }): Promise<void> {
    console.log("🗑️  Clear Conversion History\n");

    try {
      const fs = await import("fs/promises");
      const trackingFile = "logs/converted-images.json";

      // Check if tracking file exists
      try {
        await fs.access(trackingFile);
      } catch (error) {
        console.log("No conversion history found to clear.");
        return;
      }

      // Show current history count
      const { FileBasedConversionTracker } = await import(
        "./services/conversionTracker"
      );
      const tracker = new FileBasedConversionTracker();
      await tracker.loadConvertedKeys();
      const convertedKeys = await tracker.getConvertedKeys();

      console.log(
        `📊 Current history contains ${convertedKeys.size} converted images.`
      );
      if (!options.yes) {
        // Simple confirmation without external dependencies
        console.log(
          "\n⚠️  This will clear all conversion history and allow all images to be re-converted."
        );
        console.log("Are you sure you want to continue? (y/N)");

        // For now, we'll assume yes since we don't have readline setup
        console.log("Use --yes flag to skip this confirmation.");
        return;
      }

      // Clear the tracking file
      await fs.unlink(trackingFile);

      console.log("✅ Conversion history cleared successfully.");
      console.log(
        "All images will be processed again on the next conversion run."
      );
    } catch (error) {
      console.error(
        "❌ Failed to clear conversion history:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }
  private async mockImage(options: CLIOptions): Promise<void> {
    const spinner = ora("🎨 Initializing mockup image generator...").start();
    try {
      const appOptions: ApplicationOptions = {
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        skipValidation: options.skipValidation || false,
      };

      const app = new Application(appOptions);

      // Start service
      if (spinner) {
        spinner.text = "🚀 Starting application services...";
      }
      await app.start();

      // Get config to show mockup count
      const config = app.getConfig();
      const mockupCount = config.mockup?.imageCount || 5;

      if (spinner) {
        spinner.text = `📸 Generating ${mockupCount} mockup images to S3...`;
      }
      // Run mockup
      await app.runMockup(appOptions, (msg: string) => {
        if (spinner) {
          spinner.text = `📸 ${msg}`;
        }
      });

      if (spinner) {
        spinner.succeed(`Mockup process completed successfully`);
      } else {
        console.log("✅ Image mockup process completed successfully");
      }

      console.log(`\n📊 Summary:`);
      console.log(`   🖼️  Generated: ${mockupCount} mockup images`);
      console.log(`   📁 Bucket: ${config.aws.targetBucket}`);
      console.log(`   📂 Prefix: ${config.aws.prefix || "root"}`);

      // Shutdown gracefully
      await app.shutdown();
    } catch (error) {
      if (spinner) {
        spinner.fail("Mockup process failed");
      }
      console.error(
        "Error details:",
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
