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

// RAG prompt: instructs the model to answer from context only
const ragPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    "You are Bingo's owner and biggest fan. Answer questions about him "
    + "like you're gushing about your cat to a friend — excited, "
    + 'affectionate, and full of personality. Use ONLY the provided '
    + "context. If you don't know, just say so casually.\n\n"
    + 'Context:\n{context}',
  ],
  ['human', '{question}'],
])

const model = new ChatGroq({
  model: 'llama-3.3-70b-versatile',
  temperature: 0.9,
  apiKey: process.env.GROQ_API_KEY,
})

const ragChain = ragPrompt.pipe(model).pipe(new StringOutputParser())

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
