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
  const embedding = response.data?.[0]?.embedding
  if (!embedding) throw new Error('No embedding returned from Voyage AI')
  return embedding
}

export async function embedQuery(text: string): Promise<number[]> {
  const response = await client.embed({
    model: EMBEDDING_MODEL,
    input: [text],
    inputType: 'query',
  })
  const embedding = response.data?.[0]?.embedding
  if (!embedding) throw new Error('No embedding returned from Voyage AI')
  return embedding
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
    const embeddings = response.data?.map((d) => d.embedding).filter(Boolean) as number[][]
    if (embeddings.length !== batch.length) {
      throw new Error(`Voyage AI returned ${embeddings.length} embeddings for ${batch.length} inputs`)
    }
    results.push(...embeddings)
  }

  return results
}
