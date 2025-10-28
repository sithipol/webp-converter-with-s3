import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export interface Config {
  aws: {
    region: string;
    targetBucket: string;
    accessKeyId?: string | undefined;
    secretAccessKey?: string | undefined;
    prefix?: string | undefined;
    cacheControl?: string | undefined;
  };
  conversion: {
    quality: number;
    supportedFormats: string[];
    maxFileSize: number;
  };
  processing: {
    concurrency: number;
    retryAttempts: number;
    retryDelay: number;
  };
  logging: {
    level: string;
    format: string;
  };
  server: {
    port: number;
    host: string;
  };
}

export interface ValidationError {
  field: string;
  message: string;
}

export class ConfigurationError extends Error {
  public readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    const message = `Configuration validation failed:\n${errors
      .map((e) => `- ${e.field}: ${e.message}`)
      .join("\n")}`;
    super(message);
    this.name = "ConfigurationError";
    this.errors = errors;
  }
}

/**
 * Validates AWS bucket name according to S3 naming rules
 */
function validateBucketName(bucketName: string): boolean {
  if (!bucketName || bucketName.length < 3 || bucketName.length > 63) {
    return false;
  }

  // Check for valid characters and format
  const bucketRegex = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
  if (!bucketRegex.test(bucketName)) {
    return false;
  }

  // Check for consecutive periods or hyphens
  if (bucketName.includes("..") || bucketName.includes("--")) {
    return false;
  }

  // Check for IP address format
  const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (ipRegex.test(bucketName)) {
    return false;
  }

  return true;
}

/**
 * Validates AWS region format
 */
function validateAwsRegion(region: string): boolean {
  if (!region) return false;

  // AWS region format: us-east-1, eu-west-1, etc.
  const regionRegex = /^[a-z]{2,}-[a-z]+-\d+$/;
  return regionRegex.test(region);
}

/**
 * Validates log level
 */
function validateLogLevel(level: string): boolean {
  const validLevels = ["error", "warn", "info", "debug"];
  return validLevels.includes(level.toLowerCase());
}

/**
 * Validates configuration object
 */
export function validateConfig(config: Config): ValidationError[] {
  const errors: ValidationError[] = [];

  // AWS configuration validation
  if (!validateAwsRegion(config.aws.region)) {
    errors.push({
      field: "aws.region",
      message:
        "Invalid AWS region format. Expected format: us-east-1, eu-west-1, etc.",
    });
  }

  if (!validateBucketName(config.aws.targetBucket)) {
    errors.push({
      field: "aws.targetBucket",
      message:
        "Invalid S3 bucket name. Must be 3-63 characters, lowercase letters, numbers, hyphens, and periods only.",
    });
  }

  // Conversion configuration validation
  if (config.conversion.quality < 1 || config.conversion.quality > 100) {
    errors.push({
      field: "conversion.quality",
      message: "WebP quality must be between 1 and 100",
    });
  }

  if (config.conversion.maxFileSize <= 0) {
    errors.push({
      field: "conversion.maxFileSize",
      message: "Maximum file size must be greater than 0",
    });
  }

  if (
    !Array.isArray(config.conversion.supportedFormats) ||
    config.conversion.supportedFormats.length === 0
  ) {
    errors.push({
      field: "conversion.supportedFormats",
      message: "Supported formats must be a non-empty array",
    });
  }

  // Processing configuration validation
  if (config.processing.concurrency < 1 || config.processing.concurrency > 50) {
    errors.push({
      field: "processing.concurrency",
      message: "Concurrency must be between 1 and 50",
    });
  }

  if (
    config.processing.retryAttempts < 0 ||
    config.processing.retryAttempts > 10
  ) {
    errors.push({
      field: "processing.retryAttempts",
      message: "Retry attempts must be between 0 and 10",
    });
  }

  if (
    config.processing.retryDelay < 100 ||
    config.processing.retryDelay > 30000
  ) {
    errors.push({
      field: "processing.retryDelay",
      message: "Retry delay must be between 100ms and 30000ms",
    });
  }

  // Logging configuration validation
  if (!validateLogLevel(config.logging.level)) {
    errors.push({
      field: "logging.level",
      message: "Log level must be one of: error, warn, info, debug",
    });
  }

  const validFormats = ["json", "simple", "combined"];
  if (!validFormats.includes(config.logging.format)) {
    errors.push({
      field: "logging.format",
      message: "Log format must be one of: json, simple, combined",
    });
  }

  // Server configuration validation
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push({
      field: "server.port",
      message: "Server port must be between 1 and 65535",
    });
  }

  return errors;
}

/**
 * Loads configuration from environment variables with defaults
 */
export function loadConfig(): Config {
  const config: Config = {
    aws: {
      region: process.env.AWS_REGION || "ap-southeast-1",
      targetBucket: process.env.AWS_BUCKET || "my-webp-bucket",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      prefix: process.env.AWS_PREFIX || "",
    },
    conversion: {
      quality: parseInt(process.env.WEBP_QUALITY || "80", 10),
      supportedFormats: (process.env.SUPPORTED_FORMATS || "jpeg,jpg,png")
        .split(",")
        .map((f) => f.trim().toLowerCase()),
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "104857600", 10), // 100MB default
    },
    processing: {
      concurrency: parseInt(process.env.CONCURRENCY || "5", 10),
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || "3", 10),
      retryDelay: parseInt(process.env.RETRY_DELAY || "1000", 10), // 1 second default
    },
    logging: {
      level: (process.env.LOG_LEVEL || "info").toLowerCase(),
      format: (process.env.LOG_FORMAT || "json").toLowerCase(),
    },
    server: {
      port: parseInt(process.env.PORT || "3000", 10),
      host: process.env.HOST || "0.0.0.0",
    },
  };

  // Validate the configuration
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigurationError(errors);
  }

  return config;
}

/**
 * Gets the current configuration instance
 */
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Resets the configuration instance (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
