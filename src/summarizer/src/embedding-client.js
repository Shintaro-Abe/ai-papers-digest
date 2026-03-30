'use strict';

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MODEL_ID = 'amazon.titan-embed-text-v2:0';
const DIMENSION = 768;

const client = new BedrockRuntimeClient({ region: REGION });

/**
 * Generate a 768-dimension embedding vector using Bedrock Titan Embeddings V2.
 *
 * @param {string} text - Input text to embed (title + summary).
 * @returns {Promise<number[]>} 768-dimension float32 array.
 */
async function generateEmbedding(text) {
  const truncated = text.slice(0, 8000); // Titan V2 max input ~8K tokens

  const response = await client.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: truncated,
        dimensions: DIMENSION,
        normalize: true,
      }),
    })
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const embedding = result.embedding;

  if (!Array.isArray(embedding) || embedding.length !== DIMENSION) {
    throw new Error(
      `Unexpected embedding dimension: expected ${DIMENSION}, got ${embedding?.length}`
    );
  }

  return embedding;
}

module.exports = { generateEmbedding };
