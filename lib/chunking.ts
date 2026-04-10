/**
 * Splits text into overlapping chunks, preferring paragraph boundaries.
 * chunkSize and overlap are in characters.
 */
export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > chunkSize && current.length > 0) {
      chunks.push(current.trim())
      // overlap: keep last `overlap` chars of current as start of next chunk
      current = current.slice(-overlap) + '\n\n' + paragraph
    } else {
      current = current ? current + '\n\n' + paragraph : paragraph
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim())
  }

  // If a single paragraph exceeds chunkSize, split by characters
  return chunks.flatMap((chunk) => {
    if (chunk.length <= chunkSize) return [chunk]
    const parts: string[] = []
    for (let i = 0; i < chunk.length; i += chunkSize - overlap) {
      parts.push(chunk.slice(i, i + chunkSize))
    }
    return parts
  })
}
