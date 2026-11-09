import 'dotenv/config'
import { z } from 'zod'
import { ChatGroq } from '@langchain/groq'
import { FAST_MODEL } from './models.js'

// Schema for personal facts a user might share in chat.
// A single message usually won't contain all of them, and the
// extractor returns null for anything the message didn't mention.
const factSchema = z.object({
  name: z.string().nullable().describe("The person's name"),
  age: z.string().nullable().describe("The person's age"),
  city: z.string().nullable().describe('The city they live in'),
  profession: z.string().nullable().describe('Their job or profession'),
  favoriteFood: z.string().nullable().describe('Their favorite food or dish'),
  hobbies: z.array(z.string()).nullable().describe("an array of hobby strings, e.g. ['hiking', 'painting'] — even a single hobby must still be wrapped in an array, never a plain string"),
  other: z.string().nullable().describe('Any other personal fact not covered above'),
})

// Structured extractor: given a chat message, returns a typed object
// with nulls for any fields the message didn't mention.
const extractor = new ChatGroq({
  model: FAST_MODEL,
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
}).withStructuredOutput(factSchema)

const EXTRACTION_RULES = 'Extract personal facts the sender states about '
  + 'THEMSELVES in their message. Use null for every field they did not '
  + 'state. Facts about other people, pets or characters are not facts '
  + 'about the sender, so use null for those. Questions usually contain '
  + 'no facts. Never guess or fill in a value.'

// Extract personal facts from a single message string.
// Returns an all-null object if the structured call fails, so the
// caller can continue without crashing.
export async function extractFacts(message) {
  try {
    return await extractor.invoke([
      { role: 'system', content: EXTRACTION_RULES },
      { role: 'human', content: message },
    ])
  } catch (err) {
    console.warn(`extractFacts failed, skipping fact extraction for this message: ${err.message}`)
    return {
      name: null,
      age: null,
      city: null,
      profession: null,
      favoriteFood: null,
      hobbies: null,
      other: null,
    }
  }
}

// --- In-memory profile store ---
// Maps senderId -> merged profile object. All data is lost on restart.
const profiles = {}

// Models sometimes fill a field with these instead of null. Treating them
// as real answers would overwrite something true with nothing.
const EMPTY_VALUES = new Set(['', 'null', 'none', 'unknown', 'n/a', 'not mentioned'])

function isRealValue(value) {
  return typeof value === 'string' && !EMPTY_VALUES.has(value.trim().toLowerCase())
}

// Merge extracted facts into a sender's stored profile, and return
// whether anything was saved.
// - Real values in `facts` overwrite existing values.
// - Null or blank fields are ignored (don't erase previously known info).
// - The `hobbies` array is merged & deduped rather than replaced.
export function saveFacts(senderId, facts) {
  if (!profiles[senderId]) {
    profiles[senderId] = {}
  }
  const profile = profiles[senderId]
  let saved = false

  for (const [key, value] of Object.entries(facts)) {
    if (key === 'hobbies' && Array.isArray(value)) {
      const newHobbies = value.filter(isRealValue)
      if (newHobbies.length === 0) continue
      profile.hobbies = [...new Set([...(profile.hobbies || []), ...newHobbies])]
      saved = true
    } else if (isRealValue(value)) {
      profile[key] = value.trim()
      saved = true
    }
  }
  return saved
}

export function hasProfile(senderId) {
  return Object.keys(profiles[senderId] || {}).length > 0
}

// Return a friendly human-readable summary of everything known
// about a sender, or a fallback message if nothing is stored yet.
export function formatProfile(senderId) {
  if (!hasProfile(senderId)) {
    return "I don't know anything about you yet!"
  }
  const profile = profiles[senderId]

  const lines = ['Here\'s what I know about you:']
  const labels = {
    name: 'Name',
    age: 'Age',
    city: 'City',
    profession: 'Profession',
    favoriteFood: 'Favorite food',
    hobbies: 'Hobbies',
    other: 'Other',
  }

  for (const [key, label] of Object.entries(labels)) {
    const value = profile[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      lines.push(`  ${label}: ${value.join(', ')}`)
    } else {
      lines.push(`  ${label}: ${value}`)
    }
  }

  return lines.join('\n')
}
