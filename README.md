# WhatsApp AI Bot (Bingo's Assistant)

A WhatsApp bot powered by **Baileys** (WhatsApp Web protocol) and **LangChain** with **Groq** (LLaMA 3.3 70B). It has three conversation modes:

- **General chat** — warm, conversational replies with per-sender memory
- **RAG knowledge base** — answers questions about my cat Bingo using facts from `kb.txt`
- **Personal-facts memory** — extracts and remembers user-provided personal details (name, city, hobbies, etc.) and recalls them on demand

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Add your Groq API key to .env
#    Get one at https://console.groq.com
#    GROQ_API_KEY=gsk_your_key_here

# 4. Start the bot
npm start

# 5. Scan the QR code that appears in the terminal
#    using WhatsApp → Linked Devices → Link a Device
```

## Architecture

| File | Role |
|---|---|
| `index.js` | Baileys WhatsApp connection, session persistence, message listener. Routes every incoming text through `router.js`. |
| `router.js` | Decides which handler to invoke for each message: recall (personal info), RAG (Bingo facts), or general chat. |
| `rag.js` | Reads `kb.txt`, embeds each fact locally via HuggingFaceTransformersEmbeddings (`all-MiniLM-L6-v2`), retrieves top-6 matches per query, and answers via Groq. |
| `memory.js` | Zod-schema-based structured extraction of personal facts from messages. Stores profiles in-memory per sender. |
| `kb.txt` | One fact per line about Bingo the cat — the bot's knowledge base. |

### Message routing flow

```
Incoming text
    │
    ▼
Is it asking "what do you know about me"?
    ├── YES → formatProfile(senderId) from memory.js — no LLM call
    │
    └── NO  → extractFacts(text) — save any personal info found
              │
              ▼
        Contains keywords (bingo, cat, kitty, pet)?
              ├── YES → answerFromKB(text) from rag.js
              │
              └── NO  → chainWithHistory.invoke(text) — general chat
```

## First run note

The first time RAG is used, HuggingFaceTransformersEmbeddings downloads the model **Xenova/all-MiniLM-L6-v2** (~30–90 MB). This is normal and the model is cached locally afterward.

## Known limitations

- **Personal-facts memory is in-memory only** — all profiles are lost if the bot restarts. No database is used, by design for this assignment.
- **RAG routing uses keyword matching** (`bingo`, `cat`, `kitty`, `pet`) rather than an LLM classifier. Reliable for this use case but not perfect.
- **Session persistence** survives restarts (via `auth_info_baileys/` folder), but if you log out from your phone you must delete that folder and re-scan the QR.

---

## Example conversation 1: storing and recalling personal info

**You:** So do you know my name?

**Bot:** Haha, nope! I don't think we've met before! But that's okay, let's get this purr-ty started! Want to talk about my fur baby Bingo?

**You:** My name is fati

**Bot:** Hi Fati! big smile So nice to meet you! Now, let's get back to the star of the show... Bingo! My little fur baby is just the best, aww! What do you want to know about him?

**You:** I don't want to talk about bingo right now so lets not discuss that

**Bot:** Aw, okay! I'm a bit bummed, I was so excited to gush about my sweet Bingo, but no worries, let's talk about something else then! What's new with you?

**You:** Yes no more bingo pls, also I like going for camping and I love reading books

**Bot:** Aww, okay, no more Bingo talk for now! So, you like camping and reading books, huh? That sounds like so much fun!

**You:** What do you know about me?

**Bot:** [PASTE THE RECALL RESPONSE HERE ONCE CAPTURED]

*(See screenshots/ folder for original images.)*

---

## Example conversation 2: RAG knowledge base question

**You:** How old is bingo?

**Bot:** Oh, I just LOVE talking about Bingo! As of 2026, Bingo is a cool 6 years old! Isn't that just purr-fect?

**You:** Does bingo has a whiskers?

**Bot:** Oh, I just love talking about Bingo! However, I don't know if Bingo has whiskers. The context doesn't mention anything about whiskers, so I won't make any guesses! But I can tell you all about his sharp claws and mischievous personality if you'd like!

**You:** What bingo can do with his claws?

**Bot:** OH MY WHISKERS! Bingo has those VERY LARGE, SHARP CLAWS, and I just know they must be super useful for all sorts of things! However, I don't know exactly what he can do with them, as it's not specified in the context... BUT, I can imagine those sharp claws must be perfect for grasping and climbing, maybe even defending himself if needed!

*(See screenshots/ folder for original images.)*

---

## Example conversation 3: normal chat

**You:** Crime and action like

**Bot:** Haha, okay Fati! So, you want to know about Bingo's "criminal" activities? Well, let me tell you, he's a master thief... of hearts and snacks! He's always stealing my food and running away with it, haha! And when it comes to action, this little guy can climb a cat tree in like 2 seconds flat! Aww, I'm so proud of my little ninja cat!

**You:** What is the capital of france

**Bot:** Haha, Fati, you're changing subjects on me! Okay, okay, I'll play along! The capital of France is... PARIS! But let me tell you, Bingo could care less about geography, he's too busy napping in the sunbeams! Aww, my little fur ball is the real king of France... in my heart, at least!

*(See screenshots/ folder for original images.)*
