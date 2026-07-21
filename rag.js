import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { ChatGroq } from '@langchain/groq'
import { StringOutputParser } from '@langchain/core/output_parsers'

// Reads kb.txt and returns an array of non-empty, trimmed fact lines.
function loadFacts() {
  const raw = readFileSync('kb.txt', 'utf-8')
  return raw.split('\n').map(l => l.trim()).filter(Boolean)
}

// Build the embeddings (runs locally via @xenova/transformers).
// First run downloads "Xenova/all-MiniLM-L6-v2" (~30-90 MB) then caches it.
const embeddings = new HuggingFaceTransformersEmbeddings({
  model: 'Xenova/all-MiniLM-L6-v2',
})

// Ingest facts into an in-memory vector store and create a retriever
// that returns the top 3 most semantically similar facts per query.
const facts = loadFacts()
const vectorStore = await MemoryVectorStore.fromTexts(
  facts,
  facts.map(() => ({})),
  embeddings,
)
const retriever = vectorStore.asRetriever({ k: 6 })

// RAG prompt: strictly separates tone from factual accuracy.
// The model must NEVER invent a fact about Bingo, but is free to
// express enthusiasm and warmth in *how* it phrases the answer.
const ragPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are answering questions about Bingo the cat. You must use '
    + 'ONLY the facts given in the context below — never invent, assume, '
    + 'or add any fact about Bingo that is not explicitly stated in the '
    + 'context, even if it seems plausible. If the context does not '
    + 'contain the answer, clearly say you do not know that about Bingo '
    + 'instead of guessing.\n\n'
    + 'However, you may freely express excitement, warmth, and '
    + 'personality in HOW you phrase the answer — use an enthusiastic, '
    + 'friendly tone, emojis, and fun phrasing. Just never let that '
    + 'enthusiasm lead you to add new facts that are not in the '
    + 'context.\n\n'
    + 'Context:\n{context}',
  ],
  ['human', '{question}'],
])

// Lower temperature for RAG — reduces the model's tendency to
// improvise facts while still leaving room for lively phrasing.
const ragModel = new ChatGroq({
  model: 'llama-3.3-70b-versatile',
  temperature: 0.3,
  apiKey: process.env.GROQ_API_KEY,
})

const ragChain = ragPrompt.pipe(ragModel).pipe(new StringOutputParser())

// Returns the raw page_content strings of the top-3 retrieved facts
// for a given question, without invoking the LLM.
export async function getRetrievedChunks(question) {
  const docs = await retriever.invoke(question)
  return docs.map(d => d.pageContent)
}

// Returns top-5 results with similarity scores for debugging purposes.
export async function debugRetrieval(question) {
  const results = await vectorStore.similaritySearchWithScore(question, 5)
  return results.map(([doc, score]) => ({
    text: doc.pageContent,
    score,
  }))
}

// Public entry point: retrieves relevant facts, formats them as context,
// and runs the RAG chain to produce an answer.
export async function answerFromKB(question) {
  const context = (await getRetrievedChunks(question)).join('\n')
  return ragChain.invoke({ context, question })
}
