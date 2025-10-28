import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import logger from "../utils/logger";
import { getConfig } from "../config";

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
const config = getConfig(); 

export const convertImages = async (bucket: string, prefix: string = "") => {
  logger.info(`Starting conversion for bucket: ${bucket}`);

  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  );

  if (!list.Contents || list.Contents.length === 0) {
    logger.warn("No files found");
    return;
  }

  for (const file of list.Contents) {
    if (!file.Key?.match(/\.(png|jpe?g)$/i)) continue;

    const newKey = file.Key.replace(/\.(png|jpe?g)$/i, ".webp");
    logger.info(`Converting ${file.Key} to ${newKey}`);

    const inputStream = (
      await s3.send(new GetObjectCommand({ Bucket: bucket, Key: file.Key }))
    ).Body!;
    const outputBuffer = await sharp(await inputStream.transformToByteArray())
      .webp({ quality: config.conversion.quality })
      .toBuffer();

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: newKey,
        Body: outputBuffer,
        ContentType: "image/webp",
      })
    );

    logger.info(`✅ Done: ${newKey}`);
  }

  logger.info("✅ All files converted successfully");
};
