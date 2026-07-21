import { extractFacts, saveFacts, formatProfile } from './memory.js'

const senderId = 'test123'

const messages = [
  "Hi! My name is Sara and I'm 21 years old.",
  'I live in Lahore and I work as a graphic designer.',
  'I love hiking and painting, oh and my favorite food is biryani.',
]

for (let i = 0; i < messages.length; i++) {
  console.log(`\n--- Message ${i + 1} ---`)
  console.log(`Text: "${messages[i]}"`)

  const facts = await extractFacts(messages[i])
  console.log('Extracted facts:', JSON.stringify(facts, null, 2))

  saveFacts(senderId, facts)
}

console.log('\n=== Merged profile ===')
console.log(formatProfile(senderId))

console.log('\n=== Unknown sender fallback ===')
console.log(formatProfile('never_seen_before'))
