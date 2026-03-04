require('dotenv').config();
const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt, loadAllWorkflows } = require('./knowledge-base');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 4096;
const DEDICATED_CHANNEL = process.env.DEDICATED_CHANNEL || 'ask-aihelp';
const REPLY_IN_THREAD = process.env.REPLY_IN_THREAD !== 'false';

const conversations = new Map();
const MAX_HISTORY = 20;
let botUserId = null;

function getConversationKey(channelId, threadTs) {
  return threadTs ? `${channelId}-${threadTs}` : channelId;
}

function getHistory(key) {
  if (!conversations.has(key)) conversations.set(key, []);
  return conversations.get(key);
}

function addToHistory(key, role, content) {
  const history = getHistory(key);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) conversations.set(key, history.slice(-MAX_HISTORY));
}

function cleanMention(text) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

function splitMessage(text, maxLen = 3900) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { parts.push(remaining); break; }
    let cutPoint = remaining.lastIndexOf('\n', maxLen);
    if (cutPoint < maxLen * 0.5) cutPoint = remaining.lastIndexOf('. ', maxLen);
    if (cutPoint < maxLen * 0.5) cutPoint = remaining.lastIndexOf(' ', maxLen);
    if (cutPoint < maxLen * 0.5) cutPoint = maxLen;
    parts.push(remaining.substring(0, cutPoint + 1));
    remaining = remaining.substring(cutPoint + 1);
  }
  return parts;
}

async function processWithClaude(messageText, conversationKey) {
  addToHistory(conversationKey, 'user', messageText);
  const history = getHistory(conversationKey);
  const systemPrompt = buildSystemPrompt();
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: history,
    });
    const reply = response.content[0].text;
    addToHistory(conversationKey, 'assistant', reply);
    return { text: reply, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  } catch (error) {
    console.error('Error Claude API:', error.message);
    if (error.status === 401) return { text: ':x: Error de autenticacion con la API de Claude. Contacta al admin.', usage: null };
    if (error.status === 429) return { text: ':hourglass_flowing_sand: Demasiadas peticiones. Espera un momento y reintenta.', usage: null };
    return { text: ':warning: Error al procesar tu pregunta. Intenta de nuevo o contacta al admin.', usage: null };
  }
}

app.event('app_mention', async ({ event, say }) => {
  const userMessage = cleanMention(event.text);
  if (!userMessage) {
    await say({ text: ':wave: Hola! Soy el Weavy Agent de Pixelflakes. Hazme cualquier pregunta sobre los workflows y te ayudo.', thread_ts: REPLY_IN_THREAD ? event.ts : undefined });
    return;
  }
  const convKey = getConversationKey(event.channel, REPLY_IN_THREAD ? event.ts : undefined);
  const result = await processWithClaude(userMessage, convKey);
  const parts = splitMessage(result.text);
  for (const part of parts) {
    await say({ text: part, thread_ts: REPLY_IN_THREAD ? event.ts : undefined });
  }
});

app.event('message', async ({ event, say }) => {
  if (event.bot_id || event.subtype) return;
  if (event.text && botUserId && event.text.includes(`<@${botUserId}>`)) return;
  const isDM = event.channel_type === 'im';
  let isDedicatedChannel = false;
  if (event.channel_type === 'channel' || event.channel_type === 'group') {
    try {
      const channelInfo = await app.client.conversations.info({ token: process.env.SLACK_BOT_TOKEN, channel: event.channel });
      isDedicatedChannel = channelInfo.channel.name === DEDICATED_CHANNEL;
    } catch (e) {}
  }
  if (!isDM && !isDedicatedChannel) return;
  const userMessage = event.text;
  if (!userMessage || userMessage.trim() === '') return;
  const threadTs = isDedicatedChannel && REPLY_IN_THREAD ? event.ts : event.thread_ts;
  const convKey = getConversationKey(event.channel, threadTs || event.ts);
  const result = await processWithClaude(userMessage, convKey);
  const parts = splitMessage(result.text);
  for (const part of parts) {
    await say({ text: part, thread_ts: threadTs });
  }
});

app.command('/weavy', async ({ command, ack, respond }) => {
  await ack();
  const userMessage = command.text;
  if (!userMessage || userMessage.trim() === '') {
    const workflows = loadAllWorkflows();
    const list = workflows.length > 0
      ? workflows.map((w, i) => `${i + 1}. *${w.name}* - ${w.description}`).join('\n')
      : 'No hay workflows cargados todavia.';
    await respond({ text: `:brain: *Pixelflakes Weavy Agent*\n\n*Workflows disponibles:*\n${list}\n\nUsa \`/weavy [tu pregunta]\` para preguntar algo.`, response_type: 'ephemeral' });
    return;
  }
  await respond({ text: `:thinking_face: Procesando...`, response_type: 'in_channel' });
  const convKey = `slash-${command.channel_id}-${Date.now()}`;
  const result = await processWithClaude(userMessage, convKey);
  await respond({ text: result.text, response_type: 'in_channel', replace_original: true });
});

(async () => {
  await app.start();
  try {
    const authResult = await app.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
    botUserId = authResult.user_id;
  } catch (e) {
    console.warn('No se pudo obtener el bot user ID:', e.message);
  }
  const workflows = loadAllWorkflows();
  console.log(`Pixelflakes Weavy Agent ONLINE | Modelo: ${CLAUDE_MODEL} | Workflows: ${workflows.length} | Canal: #${DEDICATED_CHANNEL}`);
})();
