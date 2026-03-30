'use strict';

const {
  S3VectorsClient,
  PutVectorsCommand,
  GetVectorsCommand,
  QueryVectorsCommand,
} = require('@aws-sdk/client-s3vectors');

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'ai-papers-digest-vectors';
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'paper-embeddings';

const client = new S3VectorsClient({ region: REGION });

/**
 * Store a vector embedding in S3 Vectors.
 *
 * @param {string} arxivId - Paper arXiv ID (used as vector key).
 * @param {number[]} embedding - 768-dimension float32 array.
 * @param {object} metadata - Filterable metadata (title, tags, date, etc.).
 */
async function putVector(arxivId, embedding, metadata) {
  await client.send(
    new PutVectorsCommand({
      vectorBucketName: VECTOR_BUCKET,
      vectorIndexName: VECTOR_INDEX,
      vectors: [
        {
          key: arxivId,
          data: { float32: embedding },
          metadata: {
            title_ja: String(metadata.title_ja || ''),
            compact_summary: String(metadata.compact_summary || '').slice(0, 2000),
            tags: Array.isArray(metadata.tags) ? metadata.tags.join(',') : '',
            date: String(metadata.date || ''),
          },
        },
      ],
    })
  );
}

/**
 * Retrieve a stored vector by key.
 *
 * @param {string} arxivId - Paper arXiv ID.
 * @returns {Promise<number[]|null>} Embedding vector or null if not found.
 */
async function getVector(arxivId) {
  try {
    const response = await client.send(
      new GetVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        vectorIndexName: VECTOR_INDEX,
        keys: [arxivId],
      })
    );
    const vectors = response.vectors || [];
    if (vectors.length === 0) return null;
    return vectors[0].data?.float32 || null;
  } catch (err) {
    console.warn(`[vectors-client] Failed to get vector for ${arxivId}: ${err.message}`);
    return null;
  }
}

/**
 * Query for similar vectors using cosine similarity.
 *
 * @param {number[]} embedding - Query vector.
 * @param {number} topK - Number of results to return.
 * @param {string|null} excludeKey - Key to exclude from results (e.g., the query paper itself).
 * @returns {Promise<Array<{key: string, score: number, metadata: object}>>}
 */
async function querySimilar(embedding, topK = 5, excludeKey = null) {
  try {
    const response = await client.send(
      new QueryVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        vectorIndexName: VECTOR_INDEX,
        queryVector: { float32: embedding },
        topK: topK + (excludeKey ? 1 : 0),
      })
    );

    const vectors = response.vectors || [];
    return vectors
      .filter((v) => v.key !== excludeKey)
      .slice(0, topK)
      .map((v) => ({
        key: v.key,
        score: Math.round((v.distance || 0) * 1000) / 1000,
        metadata: v.metadata || {},
      }));
  } catch (err) {
    console.warn(`[vectors-client] Failed to query similar vectors: ${err.message}`);
    return [];
  }
}

module.exports = { putVector, getVector, querySimilar };
