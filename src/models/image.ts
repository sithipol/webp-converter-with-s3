export interface ImageMetadata {
  originalFormat: string;
  width: number;
  height: number;
  fileSize: number;
  lastModified: Date;
  contentType: string;
}

export interface ConversionResult {
  sourceKey: string;
  targetKey: string;
  originalSize: number;
  convertedSize: number;
  compressionRatio: number;
  processingTime: number;
  status: "success" | "failed" | "skipped";
  error?: string;
}

export interface ConversionReport {
  totalImages: number;
  successful: number;
  failed: number;
  skipped: number;
  totalSizeBefore: number;
  totalSizeAfter: number;
  averageCompressionRatio: number;
  processingDuration: number;
  errors: string[];
}
export const SUPPORTED_FORMATS = ["jpeg", "jpg", "png"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];
