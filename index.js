import 'dotenv/config'    //load .env in process.env
import { handleMessage } from './router.js'
import { rememberSentMessage, senderIdFor, shouldAnswer } from './access.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason, generateMessageIDV2 } from 'baileys'
import pino from 'pino'
import qrcode from 'qrcode'

const MAX_INPUT_CHARS = 2000

// --- Reconnecting ---
// Waits longer after each failed attempt (1s, 2s, 4s ... up to 60s) so a
// WhatsApp outage doesn't turn into a tight retry loop.
const MAX_RECONNECT_DELAY_MS = 60_000
let reconnectAttempts = 0
let reconnectTimer = null

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS)
  reconnectAttempts += 1
  console.log(`Reconnecting in ${delay / 1000}s...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startBot().catch(handleStartFailure)
  }, delay)
}

function handleStartFailure(err) {
  console.error('Could not start the WhatsApp connection:', err)
  scheduleReconnect()
}

// --- Message handling ---
// Each person's messages are answered one at a time and in order, so two
// quick messages can't mix up that person's conversation history.
const senderQueues = new Map()

function enqueue(senderId, task) {
  const previous = senderQueues.get(senderId) ?? Promise.resolve()
  const next = previous.then(task, task)
  senderQueues.set(senderId, next)
  next.finally(() => {
    if (senderQueues.get(senderId) === next) senderQueues.delete(senderId)
  })
}

// Sending can fail if the connection drops mid-reply. That is logged
// rather than thrown, so it can never take the whole bot down.
async function sendText(sock, jid, text) {
  const messageId = generateMessageIDV2(sock.user?.id)
  rememberSentMessage(messageId)
  try {
    await sock.sendMessage(jid, { text }, { messageId })
  } catch (err) {
    console.error('Could not send WhatsApp message:', err)
  }
}

async function answerMessage(sock, jid, senderId, text) {
  if (text.length > MAX_INPUT_CHARS) {
    await sendText(sock, jid, `That message is too long for me, please keep it under ${MAX_INPUT_CHARS} characters.`)
    return
  }
  try {
    const reply = await handleMessage(senderId, text)
    await sendText(sock, jid, reply)
  } catch (err) {
    console.error('Could not generate a reply:', err)
    await sendText(sock, jid, "Sorry, I couldn't think of a reply just now, try again in a moment")
  }
}

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
      reconnectAttempts = 0
      console.log('WhatsApp connection opened successfully')
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      if (statusCode === DisconnectReason.loggedOut) {
        // Explicit logout – can't recover without re-scanning QR
        console.log('Logged out. Delete auth_info_baileys/ and restart.')
      } else if (statusCode === DisconnectReason.connectionReplaced) {
        // Reconnecting here would make two running copies kick each other off
        console.log('This session was opened somewhere else. Stop the other copy, then restart.')
      } else if (statusCode === DisconnectReason.forbidden) {
        console.log('WhatsApp refused this account (403). Not reconnecting.')
      } else {
        // Transient disconnect (network issue, server restart, etc.) – reconnect
        console.log(`Connection closed (status ${statusCode}).`)
        scheduleReconnect()
      }
    }
  })

  // --- Credentials-update handler ---
  // Persists session tokens to disk every time they are refreshed
  // (e.g. new auth keys, server-sent updates). Without this the
  // session would be lost on next restart.
  sock.ev.on('creds.update', saveCreds)

  // --- Incoming-messages handler ---
  // 'notify' means a live message. Anything else is history being synced
  // after a reconnect, and answering that would reply to old messages.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return

    for (const message of messages) {
      if (!shouldAnswer(message, sock.user)) continue

      // Extract plain text – either a simple conversation or an
      // extended-text message (used by newer WhatsApp clients).
      const text = message.message.conversation || message.message.extendedTextMessage?.text
      if (!text) continue

      const senderId = senderIdFor(message.key)
      enqueue(senderId, () => answerMessage(sock, message.key.remoteJid, senderId, text))
    }
  })
}

// Last line of defence: log an unexpected async error instead of exiting.
process.on('unhandledRejection', err => console.error('Unhandled error:', err))

startBot().catch(handleStartFailure)
