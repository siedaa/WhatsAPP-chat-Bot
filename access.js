import 'dotenv/config'
import { isLidUser, isPnUser } from 'baileys'

// Numbers allowed to chat with the bot, besides your own account.
// Set in .env as digits with country code, comma separated. Leave it
// empty and the bot only answers you in your "Message yourself" chat.
const allowedNumbers = new Set(
  (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map(n => n.replace(/\D/g, ''))
    .filter(Boolean),
)

// IDs of messages the bot sent. In your self-chat the bot's replies look
// like messages from you, so without this it would answer itself forever.
const sentByBot = new Set()
const MAX_REMEMBERED_IDS = 200

export function rememberSentMessage(id) {
  sentByBot.add(id)
  if (sentByBot.size > MAX_REMEMBERED_IDS) {
    sentByBot.delete(sentByBot.values().next().value)
  }
}

// '923001234567:12@s.whatsapp.net' -> '923001234567'
export function bareId(jid) {
  return jid?.split('@')[0].split(':')[0]
}

// WhatsApp may identify a chat by an internal ID (@lid) and give the real
// phone number separately, so every check looks at both.
function chatIds(key) {
  return [key.remoteJid, key.remoteJidAlt].filter(Boolean).map(bareId)
}

function isSelfChat(key, me) {
  const mine = [me?.id, me?.lid, me?.phoneNumber].filter(Boolean).map(bareId)
  return chatIds(key).some(id => mine.includes(id))
}

// The phone number when WhatsApp shares it, so one person always maps to
// one memory even if their chat ID changes format.
export function senderIdFor(key) {
  const phoneJid = [key.remoteJid, key.remoteJidAlt].find(isPnUser)
  return bareId(phoneJid ?? key.remoteJid)
}

// Decides whether a message should get a reply. Everything is refused
// unless it is your self-chat or a number listed in ALLOWED_NUMBERS.
export function shouldAnswer(message, me) {
  const { key } = message
  if (!message.message) return false
  // Groups, status updates, broadcast lists and channels are never answered.
  if (!isPnUser(key.remoteJid) && !isLidUser(key.remoteJid)) return false

  const selfChat = isSelfChat(key, me)
  // Anything you type to other people is also fromMe, and is ignored.
  if (key.fromMe) return selfChat && !sentByBot.has(key.id)
  if (selfChat) return true

  const allowed = chatIds(key).some(id => allowedNumbers.has(id))
  if (!allowed) console.log(`[blocked] message from ${senderIdFor(key)}`)
  return allowed
}
