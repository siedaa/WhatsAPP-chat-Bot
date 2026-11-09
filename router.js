import 'dotenv/config'
import { z } from 'zod'
import { ChatGroq } from '@langchain/groq'
import { FAST_MODEL } from './models.js'
import { chatReply, getRecentMessages, recordTurn } from './chat.js'
import { extractFacts, saveFacts, formatProfile, hasProfile } from './memory.js'
import { answerFromKB } from './rag.js'

const routeSchema = z.object({
  route: z.enum(['recall', 'bingo', 'chat']).describe('Which handler should answer'),
  standaloneQuestion: z.string().describe(
    'The message rewritten so it makes sense with no earlier conversation, '
    + 'with words like "he" or "it" replaced by who or what they refer to',
  ),
})

// A small, fast model is enough to pick a route.
const classifier = new ChatGroq({
  model: FAST_MODEL,
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
}).withStructuredOutput(routeSchema)

const ROUTING_RULES = 'You route WhatsApp messages sent to a chatbot. The bot '
  + 'owns a cat named Bingo. Choose exactly one route:\n'
  + '- recall: the person ASKS the bot a question about what it knows or '
  + 'remembers about them, such as "what\'s my name?". A message that TELLS '
  + 'the bot something, such as "my name is Sara", is never recall.\n'
  + '- bingo: the person asks for information about Bingo, including '
  + 'follow-up questions where "he" or "him" means Bingo.\n'
  + '- chat: everything else. This includes asking to stop talking about '
  + 'Bingo, the person\'s own pets, cats or pets in general, the game of '
  + 'bingo, sharing facts about themselves, and general knowledge.'

async function chooseRoute(text, recentMessages) {
  const conversation = recentMessages
    .map(m => `${m.getType() === 'human' ? 'Person' : 'Bot'}: ${m.content}`)
    .join('\n')

  try {
    return await classifier.invoke([
      { role: 'system', content: ROUTING_RULES },
      {
        role: 'human',
        content: `Earlier conversation:\n${conversation || '(none)'}\n\nNew message to route:\n${text}`,
      },
    ])
  } catch (err) {
    // If routing fails the person should still get an answer.
    console.warn(`router: classifier failed, using keyword fallback: ${err.message}`)
    return { route: /\bbingo\b/i.test(text) ? 'bingo' : 'chat', standaloneQuestion: text }
  }
}

export async function handleMessage(senderId, text) {
  const recentMessages = await getRecentMessages(senderId)

  // Routing and fact extraction run side by side, so learning about the
  // person adds no waiting time. Both are finished before the reply, so
  // a fact shared in this message can already be used to answer it.
  const [{ route, standaloneQuestion }, facts] = await Promise.all([
    chooseRoute(text, recentMessages),
    extractFacts(text),
  ])
  if (saveFacts(senderId, facts)) {
    console.log(`[memory saved] from ${senderId}: ${JSON.stringify(facts)}`)
  }
  console.log(`[${route}] from ${senderId}`)

  if (route === 'chat') {
    const profile = hasProfile(senderId) ? formatProfile(senderId) : 'Nothing known yet.'
    return chatReply(senderId, text, profile)
  }

  const reply = route === 'recall'
    ? formatProfile(senderId)
    : await answerFromKB(standaloneQuestion, recentMessages)
  await recordTurn(senderId, text, reply)
  return reply
}
