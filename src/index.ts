import { Config, ConfigurationError, getConfig } from "./config";
import { ConversionReport } from "./models";
import {
  AWSS3Service,
  BatchConversionService,
  ExpressService,
  SharpImageProcessor,
  FileBasedConversionTracker,
} from "./services";

export interface ApplicationOptions {
  dryRun?: boolean;
  verbose?: boolean;
  skipValidation?: boolean;
}

export class Application {
  private readonly config: Config;
  private readonly s3Service: AWSS3Service;
  private readonly imageProcessor: SharpImageProcessor;
  private readonly conversionTracker: FileBasedConversionTracker;
  private readonly conversionService: BatchConversionService;
  private readonly expressService: ExpressService;
  private isShuttingDown = false;
  private readonly skipValidation: boolean;
  private readonly shutdownHandlers: (() => Promise<void>)[] = [];

  constructor(options: ApplicationOptions) {
    try {
      this.config = getConfig();
      this.s3Service = new AWSS3Service(this.config);
      this.imageProcessor = new SharpImageProcessor();
      this.conversionTracker = new FileBasedConversionTracker();

      this.conversionService = new BatchConversionService(
        this.s3Service,
        this.imageProcessor,
        this.config,
        this.conversionTracker,
        options.dryRun || false
      );
      this.expressService = new ExpressService(
        this.config,
        this.s3Service,
        this.conversionService
      );
      this.skipValidation = options.skipValidation || false;

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();
    } catch (error) {
      if (error instanceof ConfigurationError) {
        console.error("Configuration Error:", error.message);
        process.exit(1);
      }
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error("Cannot start application during shutdown");
    }

    try {
      // Run validation if not skipped
      if (!this.skipValidation) {
        // await this.validateStartupConditions();
      }

      // Start service
      await this.expressService.startServer();
    } catch (error) {
      throw error;
    }
  }
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Execute shutdown handlers in reverse order
      for (const handler of this.shutdownHandlers.reverse()) {
        await handler();
      }
      // Stop service
      await this.expressService.stopServer();
    } catch (error) {
      throw error;
    }
  }
  async runConversion(
    _options: ApplicationOptions = {}
  ): Promise<ConversionReport> {
    if (this.isShuttingDown) {
      throw new Error("Cannot run conversion during shutdown");
    }
    try {
      const report = await this.conversionService.processAllImages();
      return report;
    } catch (error) {
      throw error;
    }
  }

  async runMockup(_options: ApplicationOptions = {}): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error("Cannot run conversion during shutdown");
    }
    try {
      await this.conversionService.mockupImage();
    } catch (error) {
      throw error;
    }
  }

  private setupShutdownHandlers(): void {
    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGUSR2"];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        try {
          await this.shutdown();
          process.exit(0);
        } catch (error) {
          process.exit(1);
        }
      });
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
      process.exit(1);
    });
  }

  /**
   * Adds a custom shutdown handler
   */
  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }
  getConfig(): Config {
    return this.config;
  }
}
