import sharp from "sharp";
import { ImageMetadata, SUPPORTED_FORMATS, SupportedFormat } from "../models";
import {
  ConversionError,
  CorruptedImageError,
  ImageProcessingError,
  UnsupportedFormatError,
} from "../utils/error";

export interface ImageProcessor {
  convertToWebP(inputBuffer: Buffer, quality: number): Promise<Buffer>;
  validateImageFormat(buffer: Buffer): Promise<boolean>;
  getImageMetadata(buffer: Buffer): Promise<ImageMetadata>;
  isFormatSupported(format: string): boolean;
  validateFileIntegrity(buffer: Buffer): Promise<void>;
  validateProcessor(): Promise<void>;
}

export class SharpImageProcessor implements ImageProcessor {
  async convertToWebP(inputBuffer: Buffer, quality: number): Promise<Buffer> {
    try {
      await this.validateFileIntegrity(inputBuffer);
      const validQuality = Math.max(1, Math.min(100, quality));
      const webpBuffer = await sharp(inputBuffer)
        .webp({
          quality: validQuality,
          effort: 6, // Higher effort for better compression
          lossless: false,
        })
        .toBuffer();
      return webpBuffer;
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        throw error;
      }
      throw new ConversionError(
        error instanceof Error ? error.message : "Unknown error",
        error as Error
      );
    }
  }
  async validateImageFormat(buffer: Buffer): Promise<boolean> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.format) {
        return false;
      }
      return this.isFormatSupported(metadata.format);
    } catch (error) {
      return false;
    }
  }
  async getImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(buffer).metadata();

      if (!metadata.format || !metadata.width || !metadata.height) {
        throw new CorruptedImageError(
          "Invalid image: missing required metadata"
        );
      }

      // Check if format is supported
      if (!this.isFormatSupported(metadata.format)) {
        throw new UnsupportedFormatError(metadata.format);
      }

      // Determine content type based on format
      const contentType = this.getContentType(metadata.format);

      return {
        originalFormat: metadata.format,
        width: metadata.width,
        height: metadata.height,
        fileSize: buffer.length,
        lastModified: new Date(), // Will be overridden with S3 metadata
        contentType,
      };
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        throw error;
      }
      throw new ImageProcessingError(
        `Failed to extract image metadata: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        error as Error
      );
    }
  }
  isFormatSupported(format: string): boolean {
    const normalizedFormat = format.toLowerCase();
    return SUPPORTED_FORMATS.includes(normalizedFormat as SupportedFormat);
  }
  async validateFileIntegrity(buffer: Buffer): Promise<void> {
    try {
      // Check if buffer is empty or too small
      if (!buffer || buffer.length === 0) {
        throw new CorruptedImageError("Empty or invalid buffer");
      }

      // Minimum file size check (very small files are likely corrupted)
      if (buffer.length < 100) {
        throw new CorruptedImageError("File too small to be a valid image");
      }

      // Try to read metadata to validate file integrity
      const metadata = await sharp(buffer).metadata();

      if (!metadata.format) {
        throw new CorruptedImageError("Unable to determine image format");
      }

      // Additional integrity checks
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width <= 0 ||
        metadata.height <= 0
      ) {
        throw new CorruptedImageError("Invalid image dimensions");
      }
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        throw error;
      }
      throw new CorruptedImageError(
        "File integrity validation failed",
        error as Error
      );
    }
  }
  async validateProcessor(): Promise<void> {
    try {
      // Create a test image using Sharp to ensure it's valid and large enough
      const testBuffer = await sharp({
        create: {
          width: 10,
          height: 10,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer();

      // Test basic functionality
      const isValid = await this.validateImageFormat(testBuffer);
      if (!isValid) {
        throw new Error("Image format validation failed");
      }

      const metadata = await this.getImageMetadata(testBuffer);
      if (!metadata || metadata.width !== 10 || metadata.height !== 10) {
        throw new Error("Image metadata extraction failed");
      }

      // Test WebP conversion
      const webpBuffer = await this.convertToWebP(testBuffer, 80);
      if (!webpBuffer || webpBuffer.length === 0) {
        throw new Error("WebP conversion failed");
      }
    } catch (error) {
      throw new ImageProcessingError(
        `Image processor validation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        error as Error
      );
    }
  }
  private getContentType(format: string): string {
    const formatMap: Record<string, string> = {
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    };

    return formatMap[format.toLowerCase()] || "application/octet-stream";
  }
}
