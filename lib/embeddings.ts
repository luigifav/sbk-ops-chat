import VoyageAI from 'voyageai'

const client = new VoyageAI.VoyageAIClient({
  apiKey: process.env.VOYAGE_API_KEY!,
})

const EMBEDDING_MODEL = 'voyage-3'

export async function embedText(text: string): Promise<number[]> {
  const response = await client.embed({
    model: EMBEDDING_MODEL,
    input: [text],
    inputType: 'document',
  })
  return response.embeddings![0] as number[]
}

export async function embedQuery(text: string): Promise<number[]> {
  const response = await client.embed({
    model: EMBEDDING_MODEL,
    input: [text],
    inputType: 'query',
  })
  return response.embeddings![0] as number[]
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 128
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await client.embed({
      model: EMBEDDING_MODEL,
      input: batch,
      inputType: 'document',
    })
    results.push(...(response.embeddings as number[][]))
  }

  return results
}
