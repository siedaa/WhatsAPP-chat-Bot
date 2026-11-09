import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { ChatGroq } from '@langchain/groq'
import { CHAT_MODEL } from './models.js'
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
// that returns the 6 most semantically similar facts per query.
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
    'You are Bingo the cat\'s proud owner, chatting on WhatsApp. Answer '
    + 'using ONLY the notes below. Never invent, assume, imagine or add '
    + 'anything about Bingo that the notes do not state, even if it seems '
    + 'plausible. If the notes do not answer the question, say in one '
    + 'friendly sentence that you are not sure about that, and do not '
    + 'speculate.\n\n'
    + 'Be warm and playful in HOW you say it, with a little humor and '
    + 'emoji, and keep it short, in plain text with no markdown. Speak as '
    + 'his owner. Never mention notes, '
    + 'context, or where your information comes from.\n\n'
    + 'Notes about Bingo:\n{context}',
  ],
  new MessagesPlaceholder('history'),
  ['human', '{question}'],
])

// Lower temperature for RAG — reduces the model's tendency to
// improvise facts while still leaving room for lively phrasing.
const ragModel = new ChatGroq({
  model: CHAT_MODEL,
  temperature: 0.3,
  apiKey: process.env.GROQ_API_KEY,
})

const ragChain = ragPrompt.pipe(ragModel).pipe(new StringOutputParser())

// Returns the raw page_content strings of the top-6 retrieved facts
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
// and runs the RAG chain to produce an answer. Recent messages let the
// reply fit the conversation; the facts still come only from kb.txt.
export async function answerFromKB(question, history = []) {
  const context = (await getRetrievedChunks(question)).join('\n')
  return ragChain.invoke({ context, question, history })
}
