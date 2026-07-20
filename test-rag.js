import { answerFromKB, getRetrievedChunks, debugRetrieval } from './rag.js'

const questions = [
  'How old is Bingo?',
  'What does Bingo like to eat?',
  'Does Bingo go outside?',
  "What's the capital of France?",
]

for (const q of questions) {
  console.log(`\nQ: ${q}`)

  // Use the verbose debug retrieval for the first two questions
  // to show similarity scores; keep the normal retriever for the rest.
  if (q === questions[0] || q === questions[1]) {
    const debugResults = await debugRetrieval(q)
    console.log(`Debug retrieval (top 5 with scores):`)
    for (const r of debugResults) {
      console.log(`  score=${r.score.toFixed(4)}  ${r.text}`)
    }
  } else {
    const chunks = await getRetrievedChunks(q)
    console.log(`Retrieved chunks:`)
    for (const c of chunks) {
      console.log(`  - ${c}`)
    }
  }

  const answer = await answerFromKB(q)
  console.log(`A: ${answer}`)
}
