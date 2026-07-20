import 'dotenv/config'    //load .env in process.env
import { makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } from 'baileys'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'  //MessagesPlaceholder : savig past message
import { ChatGroq } from '@langchain/groq'
import { StringOutputParser } from '@langchain/core/output_parsers'  
import { RunnableWithMessageHistory } from '@langchain/core/runnables'  //converting model respone in to plain text
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history' //auto saves chat history in every call 
import pino from 'pino'   
import qrcode from 'qrcode'

// --- Per-sender conversation memory ---
// In-memory store mapping phone numbers to their chat histories.
// This is per-process only — all histories are lost if the bot
// restarts, which is fine for this assignment (no database yet).
const store = {}

function getSessionHistory(sessionId) {
  if (!store[sessionId]) {
    store[sessionId] = new InMemoryChatMessageHistory()
  }
  return store[sessionId]
}

// --- LangChain AI chain ---
// A "chain" is a pipeline of components that data flows through.
//   prompt  =  templates the user's message into a structured chat
//              call (system instructions + the user's text)
//   model   =  sends that chat to Groq's LLM and gets a reply
//   parser  =  converts the model's complex output object into a
//              plain string we can send back over WhatsApp
const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful WhatsApp assistant. Keep replies short and friendly.'],
  new MessagesPlaceholder('history'),
  ['human', '{text}'],
])

const chain = prompt
  .pipe(new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    apiKey: process.env.GROQ_API_KEY,
  }))
  .pipe(new StringOutputParser())

// Wrap the raw chain with history management so that past turns are
// automatically injected into the "history" placeholder on each call.
const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory: getSessionHistory,
  inputMessagesKey: 'text',
  historyMessagesKey: 'history',
})

async function startBot() {
  const logger = pino({ level: 'silent' })

  // Load saved session credentials from the auth_info_baileys directory.
  // On first run this directory is empty, so Baileys will generate new
  // credentials and emit a QR code for you to scan with your phone.
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  // Fetch the latest supported WhatsApp Web protocol version from WhatsApp's
  // servers. Using fetchLatestBaileysVersion() can ship a stale version that
  // leads to connection issues.
  const { version, isLatest } = await fetchLatestWaWebVersion()
  console.log(`Using WA version: ${version.join('.')}${isLatest ? ' (latest)' : ''}`)

  const sock = makeWASocket({
    auth: state,
    version,
    logger,
  })

  // --- Connection-update handler ---
  // Fires whenever the connection state changes.
  // - `qr`: a base64-encoded QR string to scan with WhatsApp
  // - `connection`: current state ("open", "close", "connecting")
  // - `lastDisconnect`: details about the last disconnect (used to tell
  //    a normal reconnect from a logout)
  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      // Render a scannable QR code directly in the terminal
      const qrString = await qrcode.toString(qr, { type: 'terminal', small: true })
      console.log(qrString)
    }

    if (connection === 'open') {
      console.log('WhatsApp connection opened successfully')
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) {
        // Transient disconnect (network issue, server restart, etc.) – reconnect
        console.log('Connection closed, reconnecting...')
        startBot()
      } else {
        // Explicit logout – can't recover without re-scanning QR
        console.log('Logged out. Delete auth_info_baileys/ and restart.')
      }
    }
  })

  // --- Credentials-update handler ---
  // Persists session tokens to disk every time they are refreshed
  // (e.g. new auth keys, server-sent updates). Without this the
  // session would be lost on next restart.
  sock.ev.on('creds.update', saveCreds)

  // --- Incoming-messages handler ---
  // Fires when one or more new messages arrive. We only process the
  // first message in the batch.
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0]
    // Skip messages that have no content, are sent by us, or aren't
    // 1:1 chats (group messages end with @g.us, status stories use
    // status@broadcast).
    if (!message.message || message.key.fromMe) return
    if (message.key.remoteJid.endsWith('@g.us')) return
    if (message.key.remoteJid === 'status@broadcast') return

    // Extract plain text – either a simple conversation or an
    // extended-text message (used by newer WhatsApp clients).
    const text = message.message.conversation || message.message.extendedTextMessage?.text
    if (!text) return

    // Send the message through the LangChain chain and reply with the result.
    // The chain pipes the user's text through a chat prompt, the Groq model,
    // and a string-output parser. Per-sender conversation history is managed
    // via the session ID (the sender's phone number).
    const senderId = message.key.remoteJid.split('@')[0]
    try {
      const reply = await chainWithHistory.invoke(
        { text },
        { configurable: { sessionId: senderId } },
      )
      await sock.sendMessage(message.key.remoteJid, { text: reply })
    } catch (err) {
      console.error('Groq API error:', err)
      await sock.sendMessage(message.key.remoteJid, {
        text: "Sorry, I couldn't think of a reply just now — try again in a moment",
      })
    }
  })
}

startBot()
