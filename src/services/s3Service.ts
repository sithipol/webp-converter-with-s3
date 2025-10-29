import {
  S3Client,
  ListObjectsV2Command,
  HeadBucketCommand,
  ListObjectsV2CommandOutput,
  S3ServiceException,
  GetObjectCommandOutput,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Config } from "../config/index";
import axios from "axios";

export interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface S3Service {
  listImages(bucketName: string, prefix?: string): Promise<S3Object[]>;
  uploadImage(
    bucketName: string,
    key: string,
    buffer: Buffer,
    metadata: Record<string, string>
  ): Promise<void>;
  healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      connection: boolean;
      sourceBucketAccess: boolean;
      targetBucketAccess: boolean;
    };
  }>;
  downloadImage(bucketName: string, key: string): Promise<Buffer>;
  uploadMockupImage(
    bucketName: string,
    key: string,
    imageUrl: string,
  ): Promise<void>;
}

export class AWSS3Service implements S3Service {
  private readonly client: S3Client;
  private readonly config: Config;
  private readonly supportedExtensions: Set<string>;

  constructor(config: Config) {
    this.config = config;

    // Initialize S3 client with configuration
    const clientConfig: any = {
      region: config.aws.region,
    };

    // Add credentials if provided
    if (config.aws.accessKeyId && config.aws.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);

    this.supportedExtensions = new Set(
      config.conversion.supportedFormats.map(
        (format) => format.toLowerCase().replace(/^\./, "") // Remove leading dot if present
      )
    );
  }
  async listImages(bucketName: string, prefix?: string): Promise<S3Object[]> {
    const images: S3Object[] = [];
    let continuationToken: string | undefined;
    const startTime = Date.now();
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000, // Process in batches
      });
      try {
        const response: ListObjectsV2CommandOutput = await this.client.send(
          command
        );
        if (response.Contents) {
          for (const object of response.Contents) {
            if (
              object.Key &&
              object.Size &&
              object.LastModified &&
              object.ETag
            ) {
              // Check if the file has a supported image extension
              if (this.isImageFile(object.Key)) {
                images.push({
                  key: object.Key,
                  size: object.Size,
                  lastModified: object.LastModified,
                  etag: object.ETag.replace(/"/g, ""), // Remove quotes from ETag
                });
              }
            }
          }
        }
        continuationToken = response.NextContinuationToken;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof S3ServiceException) {
          throw new Error(
            `Failed to list images from bucket ${bucketName}: ${error.message}, duration: ${duration}`
          );
        }
        throw error;
      }
    } while (continuationToken);

    return images;
  }

  async uploadImage(
    bucketName: string,
    key: string,
    buffer: Buffer,
    metadata: Record<string, string>
  ): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: "image/webp",
        Metadata: metadata,
        // Add cache control for web optimization
        CacheControl: this.config.aws.cacheControl || "public, max-age=31536000", // 1 year
      });

      await this.client.send(command);
    } catch (error) {
      if (error instanceof S3ServiceException) {
        throw new Error(
          `Failed to upload image ${key} to bucket ${bucketName}: ${error.message}`
        );
      }
      throw error;
    }
  }

  async downloadImage(bucketName: string, key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const response: GetObjectCommandOutput = await this.client.send(command);

      if (!response.Body) {
        throw new Error(
          `No body returned for object ${key} in bucket ${bucketName}`
        );
      }

      // Convert the stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      return buffer;
    } catch (error) {
      if (error instanceof S3ServiceException) {
        throw new Error(
          `Failed to download image ${key} from bucket ${bucketName}: ${error.message}`
        );
      }
      throw error;
    }
  }

  private isImageFile(key: string): boolean {
    const extension = key.split(".").pop()?.toLowerCase();
    return extension ? this.supportedExtensions.has(extension) : false;
  }
  async validateConnection(): Promise<boolean> {
    try {
      // Try to list buckets to validate connection and credentials
      const command = new ListObjectsV2Command({
        Bucket: this.config.aws.targetBucket,
        MaxKeys: 1,
      });

      await this.client.send(command);

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.log(errorMessage);
      return false;
    }
  }
  async checkBucketPermissions(bucketName: string): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: bucketName,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      error instanceof Error ? error.message : "Unknown error";

      if (error instanceof S3ServiceException) {
        // For permission checks, don't retry on access denied errors
        if (error.name === "Forbidden" || error.name === "AccessDenied") {
          return false;
        }
        throw new Error(
          `Bucket permission check failed for ${bucketName}: ${error.message}`
        );
      }

      throw error;
    }
  }

  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: {
      connection: boolean;
      sourceBucketAccess: boolean;
      targetBucketAccess: boolean;
    };
  }> {
    const details = {
      connection: false,
      sourceBucketAccess: false,
      targetBucketAccess: false,
    };

    try {
      // Check basic connection
      details.connection = await this.validateConnection();

      // Check source bucket permissions
      if (details.connection) {
        details.targetBucketAccess = await this.checkBucketPermissions(
          this.config.aws.targetBucket
        );
      }

      const isHealthy =
        details.connection &&
        details.sourceBucketAccess &&
        details.targetBucketAccess;

      return {
        status: isHealthy ? "healthy" : "unhealthy",
        details,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        details,
      };
    }
  }
  async uploadMockupImage(
    bucketName: string,
    key: string,
    imageUrl: string,
  ): Promise<void> {
    try {
      // Download image from the provided URL
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: "arraybuffer",
      });
      const buffer = Buffer.from(response.data);

      // Upload the image to S3
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        CacheControl:
          this.config.aws.cacheControl || "public, max-age=31536000", // 1 year
      });

      await this.client.send(command);
    } catch (error) {
      if (error instanceof S3ServiceException) {
        throw new Error(
          `Failed to upload mockup image ${key} to bucket ${bucketName}: ${error.message}`
        );
      }
      throw error;
    }
  }
}
