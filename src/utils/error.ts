export class ImageProcessingError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "ImageProcessingError";
  }
}
export class CorruptedImageError extends ImageProcessingError {
  constructor(
    message: string = "Image file is corrupted or invalid",
    cause?: Error
  ) {
    super(message, cause);
    this.name = "CorruptedImageError";
  }
}

export class UnsupportedFormatError extends ImageProcessingError {
  constructor(format: string, cause?: Error) {
    super(`Unsupported image format: ${format}`, cause);
    this.name = "UnsupportedFormatError";
  }
}

export class ConversionError extends ImageProcessingError {
  constructor(message: string, cause?: Error) {
    super(`Image conversion failed: ${message}`, cause);
    this.name = "ConversionError";
  }
}
