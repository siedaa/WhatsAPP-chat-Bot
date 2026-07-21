import 'dotenv/config'
import { z } from 'zod'
import { ChatGroq } from '@langchain/groq'

// Schema for personal facts a user might share in chat.
// Every field is optional — a single message usually won't contain
// all of them, and the extractor will return null for anything
// the message didn't mention.
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
  model: 'llama-3.3-70b-versatile',
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
}).withStructuredOutput(factSchema)

// Extract personal facts from a single message string.
// Returns an all-null object if the structured call fails, so the
// caller can continue without crashing.
export async function extractFacts(message) {
  try {
    return await extractor.invoke([
      {
        role: 'human',
        content: `Extract personal facts from this message:\n\n${message}`,
      },
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

// Merge extracted facts into a sender's stored profile.
// - Non-null fields in `facts` overwrite existing values.
// - Null fields are ignored (don't erase previously known info).
// - The `hobbies` array is merged & deduped rather than replaced.
export function saveFacts(senderId, facts) {
  if (!profiles[senderId]) {
    profiles[senderId] = {}
  }
  const profile = profiles[senderId]

  for (const [key, value] of Object.entries(facts)) {
    if (value === null) continue

    if (key === 'hobbies' && Array.isArray(value)) {
      const existing = profile.hobbies || []
      const merged = [...new Set([...existing, ...value])]
      profile.hobbies = merged
    } else {
      profile[key] = value
    }
  }
}

// Return a friendly human-readable summary of everything known
// about a sender, or a fallback message if nothing is stored yet.
export function formatProfile(senderId) {
  const profile = profiles[senderId]
  if (!profile || Object.keys(profile).length === 0) {
    return "I don't know anything about you yet!"
  }

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
