import { extractFacts, saveFacts, formatProfile } from './memory.js'
import { answerFromKB } from './rag.js'

export async function handleMessage(senderId, text, chatChain) {
  // 1. Check if this is a request to recall stored personal info.
  //    Uses a simple regex approach: case-insensitive, flexible phrasing
  //    around "what do you know/remember/etc about me" and "who am i".
  const recallPattern = /what\s+(do\s+)?(you\s+)?(know|remember|have|got|stored|got\s+saved)\s+(about\s+)?me|who\s+am\s+i|list\s+(everything\s+)?(you\s+)?know\s+(about\s+)?me/i
  if (recallPattern.test(text)) {
    console.log(`[recall] from ${senderId}`)
    return formatProfile(senderId)
  }

  // 2. Extract and save any personal facts from every message.
  //    Wrapped in try/catch so a fact-extraction failure never blocks
  //    the rest of the handler (RAG/chat reply still goes through).
  let facts
  try {
    facts = await extractFacts(text)
  } catch (err) {
    console.warn(`router: extractFacts threw unexpectedly: ${err.message}`)
    facts = null
  }
  const hasFacts = facts && Object.values(facts).some(v => v !== null)
  if (hasFacts) {
    saveFacts(senderId, facts)
    console.log(`[memory saved] from ${senderId}: ${JSON.stringify(facts)}`)
  }

  // 3. Check if the message is about Bingo/the knowledge base.
  //    Simple keyword check — beginner-friendly, no extra LLM cost,
  //    and reliable enough since users asking about Bingo will almost
  //    certainly mention "bingo", "cat", "kitty", or "pet".
  const kbKeywords = /\b(bingo|cat|kitty|pet)\b/i
  if (kbKeywords.test(text)) {
    console.log(`[rag] from ${senderId}`)
    return answerFromKB(text)
  }

  // 4. Default to the general chat chain with conversation memory.
  console.log(`[chat] from ${senderId}`)
  return chatChain.invoke({ text }, { configurable: { sessionId: senderId } })
}
