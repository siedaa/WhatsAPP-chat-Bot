import 'dotenv/config'

// Groq retires models over time. If you see a "model not found" error,
// change these names or override them in .env.
// Current list: https://console.groq.com/docs/models

// Writes the replies people read.
export const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b'

// Handles quick background jobs: routing and fact extraction.
export const FAST_MODEL = process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b'
