import express, { Request, Response, Application } from "express";
import { Config } from "../config";
import { S3Service } from "./s3Service";
import { ConversionService } from "./convertionService";
export interface ExpressService {
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  //   getHealthStatus(): Promise<HealthStatus>;
  //   getConversionMetrics(): ConversionMetrics;
  //   getSystemMetrics(): Promise<SystemMetrics>;
  recordConversion(
    success: boolean,
    processingTime: number,
    sizeBefore: number,
    sizeAfter: number
  ): void;
  recordS3Request(success: boolean): void;
}

export interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    s3: {
      status: "healthy" | "unhealthy";
      details: {
        connection: boolean;
        sourceBucketAccess: boolean;
        targetBucketAccess: boolean;
      };
    };
    memory: {
      status: "healthy" | "unhealthy" | "degraded";
      details: {
        used: number;
        total: number;
        percentage: number;
        heapUsed: number;
        heapTotal: number;
      };
    };
    disk: {
      status: "healthy" | "unhealthy" | "degraded";
      details: {
        available: number;
        total: number;
        percentage: number;
      };
    };
  };
}
export class ExpressService implements ExpressService {
  private readonly app: Application;
  private readonly config: Config;
  private readonly s3Service: S3Service;
  private readonly conversionService: ConversionService | undefined;
  private server: any;
  private startTime: number;

  constructor(
    config: Config,
    s3Service: S3Service,
    conversionService?: ConversionService
  ) {
    this.config = config;
    this.s3Service = s3Service;
    this.conversionService = conversionService;
    this.startTime = Date.now();
    this.app = express();

    this.setupMiddleware();
    this.setupRoutes();
  }

  async setupMiddleware() {
    this.app.use(express.json());
  }

  setupRoutes() {
    this.app.get("/health", async (_req: Request, res: Response) => {
      try {
        const health = await this.getHealthStatus();
        const statusCode =
          health.status === "healthy"
            ? 200
            : health.status === "degraded"
              ? 200
              : 503;

        res.status(statusCode).json(health);
      } catch (error) {
        res.status(503).json({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          error: "Health check failed",
        });
      }
    });
  }
  async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.server.port, () => {
        console.log(
          `Express server started on port ${this.config.server.port}`
        );
        resolve();
      });
      this.server.on("error", (error: Error) => {
        reject(error);
      });
    });
  }
  async stopServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server && this.server.listening) {
        this.server.close((err?: Error) => {
          if (err) {
            reject(err);
          } else {
            console.log("Express server stopped");
            resolve();
          }
        });
      } else {
        // Server is not running or already closed
        resolve();
      }
    });
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const s3Health = await this.s3Service.healthCheck();
    const memoryStats = this.getMemoryStats();
    const diskStats = await this.getDiskStats();

    // Determine overall status
    let overallStatus: "healthy" | "unhealthy" | "degraded" = "healthy";

    if (
      s3Health.status === "unhealthy" ||
      memoryStats.status === "unhealthy" ||
      diskStats.status === "unhealthy"
    ) {
      overallStatus = "unhealthy";
    } else if (
      memoryStats.status === "degraded" ||
      diskStats.status === "degraded"
    ) {
      overallStatus = "degraded";
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      services: {
        s3: s3Health,
        memory: memoryStats,
        disk: diskStats,
      },
    };
  }

  private getMemoryStats(): {
    status: "healthy" | "unhealthy" | "degraded";
    details: {
      used: number;
      total: number;
      percentage: number;
      heapUsed: number;
      heapTotal: number;
    };
  } {
    const memUsage = process.memoryUsage();
    const totalMemory = require("os").totalmem();
    const freeMemory = require("os").freemem();
    const usedMemory = totalMemory - freeMemory;
    const percentage = (usedMemory / totalMemory) * 100;

    let status: "healthy" | "unhealthy" | "degraded" = "healthy";
    if (percentage > 90) {
      status = "unhealthy";
    } else if (percentage > 80) {
      status = "degraded";
    }

    return {
      status,
      details: {
        used: usedMemory,
        total: totalMemory,
        percentage,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
    };
  }

  private async getDiskStats(): Promise<{
    status: "healthy" | "unhealthy" | "degraded";
    details: {
      available: number;
      total: number;
      percentage: number;
    };
  }> {
    try {
      const fs = require("fs").promises;
      const stats = await fs.statfs("./");

      const total = stats.blocks * stats.bsize;
      const available = stats.bavail * stats.bsize;
      const used = total - available;
      const percentage = (used / total) * 100;

      let status: "healthy" | "unhealthy" | "degraded" = "healthy";
      if (percentage > 95) {
        status = "unhealthy";
      } else if (percentage > 85) {
        status = "degraded";
      }

      return {
        status,
        details: {
          available,
          total,
          percentage,
        },
      };
    } catch (error) {
      // Fallback if statfs is not available
      return {
        status: "healthy",
        details: {
          available: 0,
          total: 0,
          percentage: 0,
        },
      };
    }
  }
  doSomeThingi(): void {
    // Implementation here
    this.conversionService;
  }
}
