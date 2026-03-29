"use strict";

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({});
const PAGES_BUCKET = process.env.PAGES_BUCKET;

/**
 * Upload HTML content to S3.
 */
async function upload(key, htmlContent) {
  await s3.send(
    new PutObjectCommand({
      Bucket: PAGES_BUCKET,
      Key: key,
      Body: htmlContent,
      ContentType: "text/html; charset=utf-8",
    })
  );
  console.log(`[s3-uploader] Uploaded s3://${PAGES_BUCKET}/${key}`);
}

module.exports = { upload };
