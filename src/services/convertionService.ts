import { Config } from "../config";
import { ConversionReport, ConversionResult } from "../models";
import { ImageProcessor } from "./imageProcess";
import { S3Object, S3Service } from "./s3Service";

export interface ConversionService {
  processAllImages(): Promise<ConversionReport>;
  processImage(s3Object: S3Object): Promise<ConversionResult>;
  skipIfExists(targetKey: string): Promise<boolean>;
}
interface ProcessingQueue {
  pending: S3Object[];
  processing: Set<string>;
  completed: Set<string>;
  failed: Set<string>;
}
export class BatchConversionService implements ConversionService {
  private readonly s3Service: S3Service;
  private readonly imageProcessor: ImageProcessor;
  private readonly config: Config;
  private readonly processingQueue: ProcessingQueue;
  private readonly dryRun: boolean;
  constructor(
    s3Service: S3Service,
    imageProcessor: ImageProcessor,
    config: Config,
    dryRun: boolean = false
  ) {
    this.s3Service = s3Service;
    this.imageProcessor = imageProcessor;
    this.config = config;
    this.processingQueue = {
      pending: [],
      processing: new Set(),
      completed: new Set(),
      failed: new Set(),
    };
    this.dryRun = dryRun;
  }
  async processAllImages(): Promise<ConversionReport> {
    const startTime = Date.now();
    const report: ConversionReport = {
      totalImages: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      totalSizeBefore: 0,
      totalSizeAfter: 0,
      averageCompressionRatio: 0,
      processingDuration: 0,
      errors: [],
    };
    try {
      const images = await this.s3Service.listImages(
        this.config.aws.targetBucket,
        this.config.aws.prefix || ""
      );

      if (images.length === 0) {
        report.processingDuration = Date.now() - startTime;
        return report;
      }

      // Initialize processing queue
      this.processingQueue.pending = [...images];
      this.processingQueue.processing.clear();
      this.processingQueue.completed.clear();
      this.processingQueue.failed.clear();

      await this.processConcurrentBatches(report);

      // Calculate average compression ratio
      if (report.successful > 0 && report.totalSizeBefore > 0) {
        report.averageCompressionRatio =
          (report.totalSizeBefore - report.totalSizeAfter) /
          report.totalSizeBefore;
      }

      report.processingDuration = Date.now() - startTime;

      console.info("Concurrent batch conversion completed", {
        operation: "batch.complete",
        duration: report.processingDuration,
        successful: report.successful,
        failed: report.failed,
        skipped: report.skipped,
        totalImages: report.totalImages,
      });

      if (report.successful > 0) {
        const sizeSavedMB =
          (report.totalSizeBefore - report.totalSizeAfter) / (1024 * 1024);
        const compressionPercent = (
          report.averageCompressionRatio * 100
        ).toFixed(1);

        console.info("Batch conversion size reduction summary", {
          operation: "batch.summary",
          sizeSavedMB: Number(sizeSavedMB.toFixed(2)),
          compressionPercent: Number(compressionPercent),
          totalSizeBefore: report.totalSizeBefore,
          totalSizeAfter: report.totalSizeAfter,
        });
      }

      return report;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      report.errors.push(`Batch conversion failed: ${errorMessage}`);
      report.processingDuration = Date.now() - startTime;
      return report;
    }
    // Implementation goes here
  }
  private async processConcurrentBatches(
    report: ConversionReport
  ): Promise<void> {
    const activePromises = new Map<string, Promise<ConversionResult>>();

    while (this.processingQueue.pending.length > 0 || activePromises.size > 0) {
      // Check memory usage and adjust batch size if needed

      // Start new processing tasks up to concurrency limit
      while (this.processingQueue.pending.length > 0) {
        const image = this.processingQueue.pending.shift()!;
        this.processingQueue.processing.add(image.key);

        const promise = this.processImageWithTracking(image, report);
        activePromises.set(image.key, promise);

        // Don't overwhelm the system - small delay between starts
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Wait for at least one task to complete
      if (activePromises.size > 0) {
        const completedKey = await Promise.race(
          Array.from(activePromises.entries()).map(async ([key, promise]) => {
            await promise;
            return key;
          })
        );

        // Clean up completed task
        activePromises.delete(completedKey);
        this.processingQueue.processing.delete(completedKey);
      }
    }
  }
  private async processImageWithTracking(
    image: S3Object,
    report: ConversionReport
  ): Promise<ConversionResult> {
    try {
      const result = await this.processImage(image);

      // Update report based on result
      switch (result.status) {
        case "success":
          report.successful++;
          report.totalSizeBefore += result.originalSize;
          report.totalSizeAfter += result.convertedSize;
          this.processingQueue.completed.add(image.key);
          break;
        case "failed":
          report.failed++;
          if (result.error) {
            report.errors.push(`${result.sourceKey}: ${result.error}`);
          }
          this.processingQueue.failed.add(image.key);
          break;
        case "skipped":
          report.skipped++;
          this.processingQueue.completed.add(image.key);
          break;
      }

      return result;
    } catch (error) {
      report.failed++;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      report.errors.push(`${image.key}: ${errorMessage}`);
      this.processingQueue.failed.add(image.key);
      console.error(`Failed to process image ${image.key}`, {
        operation: "conversion.processingError",
        sourceKey: image.key,
        error: errorMessage,
      });

      // Return a failed result
      return {
        sourceKey: image.key,
        targetKey: this.generateTargetKey(image.key),
        originalSize: image.size,
        convertedSize: 0,
        compressionRatio: 0,
        processingTime: 0,
        status: "failed",
        error: errorMessage,
      };
    }
  }

  async processImage(s3Object: S3Object): Promise<ConversionResult> {
    const startTime = Date.now();
    const sourceKey = s3Object.key;
    const targetKey = this.generateTargetKey(sourceKey);

    const result: ConversionResult = {
      sourceKey,
      targetKey,
      originalSize: s3Object.size,
      convertedSize: 0,
      compressionRatio: 0,
      processingTime: 0,
      status: "failed",
    };

    try {
      // Check if already converted (duplicate detection)
      if (await this.skipIfExists(targetKey)) {
        result.status = "skipped";
        result.processingTime = Date.now() - startTime;
        return result;
      }

      const imageBuffer = await this.s3Service.downloadImage(
        this.config.aws.targetBucket,
        sourceKey
      );

      // Validate image format and get metadata
      const isValid = await this.imageProcessor.validateImageFormat(
        imageBuffer
      );

      if (!isValid) {
        result.error = "Unsupported or invalid image format";
        result.processingTime = Date.now() - startTime;
        return result;
      }

      // Get image metadata for additional information
      const metadata = await this.imageProcessor.getImageMetadata(imageBuffer);

      // Convert to WebP
      const webpBuffer = await this.imageProcessor.convertToWebP(
        imageBuffer,
        this.config.conversion.quality
      );
      result.convertedSize = webpBuffer.length;

      // Calculate compression ratio
      result.compressionRatio =
        (result.originalSize - result.convertedSize) / result.originalSize;

      if (!this.dryRun) {
        // Prepare metadata for S3 upload
        const uploadMetadata = {
          "original-format": metadata.originalFormat,
          "original-size": result.originalSize.toString(),
          "converted-size": result.convertedSize.toString(),
          "compression-ratio": result.compressionRatio.toFixed(4),
          "conversion-quality": this.config.conversion.quality.toString(),
          "conversion-timestamp": new Date().toISOString(),
        };

        // Upload converted image to target bucket
        await this.s3Service.uploadImage(
          this.config.aws.targetBucket,
          targetKey,
          webpBuffer,
          uploadMetadata
        );
      } else {
        console.info(`DRY RUN: Would upload converted image`, {
          operation: "conversion.dryrun",
          sourceKey,
          targetKey,
          originalSize: result.originalSize,
          convertedSize: result.convertedSize,
          compressionRatio: result.compressionRatio,
        });
      }

      result.status = "success";
      result.processingTime = Date.now() - startTime;

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Unknown error";
      result.processingTime = Date.now() - startTime;
      return result;
    }
  }
  private generateTargetKey(sourceKey: string): string {
    const lastDotIndex = sourceKey.lastIndexOf(".");
    if (lastDotIndex === -1) {
      // No extension found, just append .webp
      return `${sourceKey}.webp`;
    }

    // Replace extension with .webp
    const baseName = sourceKey.substring(0, lastDotIndex);
    return `${baseName}.webp`;
  }
  async skipIfExists(targetKey: string): Promise<boolean> {
    try {
      // Try to get metadata of the target object
      // If it exists, we'll get metadata; if not, it will throw an error
      const images = await this.s3Service.listImages(
        this.config.aws.targetBucket,
        targetKey
      );

      // Check if exact key exists
      const exists = images.some((image) => image.key === targetKey);

      if (exists) {
        return true;
      }

      return false;
    } catch (error) {
      console.log("Error in skipIfExists:", error);
      return false;
    }
  }
}
