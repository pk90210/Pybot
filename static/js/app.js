// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('user-input');
const sendBtn    = document.getElementById('send-btn');
const convList   = document.getElementById('conv-list');

let currentConvId = null;
let isStreaming   = false;

// ---------------------------------------------------------------------------
// Marked + highlight.js config
// ---------------------------------------------------------------------------
marked.setOptions({ breaks: true, gfm: true });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadConversationList();

  document.querySelectorAll('.topic-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.q;
      if (q && !isStreaming) sendMessage(q);
    });
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });
});

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------
async function loadConversationList() {
  try {
    const res  = await fetch('/conversations');
    const list = await res.json();
    renderConvList(list);
  } catch (e) {
    console.error('Failed to load conversations', e);
  }
}

function renderConvList(list) {
  if (!list.length) {
    convList.innerHTML = '<p class="conv-empty">No conversations yet</p>';
    return;
  }
  convList.innerHTML = list.map(c => `
    <div class="conv-item ${c.id === currentConvId ? 'active' : ''}" data-id="${c.id}">
      <span class="conv-title">${escapeHtml(c.title)}</span>
      <button class="conv-delete" data-id="${c.id}" title="Delete" onclick="deleteConversation(event,'${c.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.conv-delete')) return;
      loadConversation(el.dataset.id);
    });
  });
}

function setActiveConv(id) {
  convList.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

// ---------------------------------------------------------------------------
// Load a past conversation
// ---------------------------------------------------------------------------
async function loadConversation(id) {
  if (isStreaming) return;
  try {
    const res  = await fetch(`/conversations/${id}`);
    const data = await res.json();
    if (data.error) return;

    currentConvId = id;
    setActiveConv(id);

    const welcome = messagesEl.querySelector('.welcome');
    if (welcome) welcome.remove();
    messagesEl.innerHTML = '';

    data.messages.forEach(m => {
      const bubble = createMessage(m.role === 'user' ? 'user' : 'bot');
      if (m.role === 'user') {
        bubble.textContent = m.content;
      } else {
        bubble.innerHTML = renderMarkdown(m.content);
        addCodeHeaders(bubble);
      }
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (e) {
    console.error('Failed to load conversation', e);
  }
}

// ---------------------------------------------------------------------------
// Delete a conversation
// ---------------------------------------------------------------------------
async function deleteConversation(e, id) {
  e.stopPropagation();
  await fetch(`/conversations/${id}`, { method: 'DELETE' });
  if (currentConvId === id) newChat();
  loadConversationList();
}

// ---------------------------------------------------------------------------
// New chat
// ---------------------------------------------------------------------------
function newChat() {
  if (isStreaming) return;
  currentConvId = null;
  messagesEl.innerHTML = `
    <div class="welcome">
      <div class="welcome-snake">🐍</div>
      <h2>What would you like to learn today?</h2>
      <p>Ask me anything about Python — from print("Hello, World!") to advanced async patterns.</p>
    </div>`;
  setActiveConv(null);
  inputEl.focus();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  return String(text)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMarkdown(text) {
  return marked.parse(text);
}

function addCodeHeaders(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-header')) return;
    const code = pre.querySelector('code');
    const lang = code?.className?.replace('language-','') || 'python';
    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `<span>${lang}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button>`;
    pre.insertBefore(header, pre.firstChild);
    if (code) hljs.highlightElement(code);
  });
}

function copyCode(btn) {
  const code = btn.closest('pre').querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function createMessage(role) {
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const msg    = document.createElement('div');
  msg.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'bot' ? '🐍' : 'You';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function showTyping() {
  const bubble = createMessage('bot');
  bubble.innerHTML = `<div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  return bubble;
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------
async function sendMessage(overrideText) {
  const text = overrideText || inputEl.value.trim();
  if (!text || isStreaming) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;

  const userBubble = createMessage('user');
  userBubble.textContent = text;

  const botBubble = showTyping();
  let fullText = '';

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversation_id: currentConvId }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    botBubble.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') break;
        try {
          const parsed = JSON.parse(payload);

          // First event carries conversation_id
          if (parsed.conversation_id) {
            const isNew = !currentConvId;
            currentConvId = parsed.conversation_id;
            if (isNew) {
              // Refresh sidebar to show the new conversation
              await loadConversationList();
              setActiveConv(currentConvId);
            }
            continue;
          }

          if (parsed.text) {
            fullText += parsed.text;
            botBubble.innerHTML = renderMarkdown(fullText);
            addCodeHeaders(botBubble);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        } catch {}
      }
    }

    // Final render
    botBubble.innerHTML = renderMarkdown(fullText);
    addCodeHeaders(botBubble);

    // Refresh sidebar title (server sets it on first message)
    loadConversationList().then(() => setActiveConv(currentConvId));

  } catch (err) {
    botBubble.innerHTML = `<span style="color:#e26060">⚠ ${escapeHtml(err.message || 'Something went wrong.')}</span>`;
  }

  isStreaming = false;
  sendBtn.disabled = false;
  messagesEl.scrollTop = messagesEl.scrollHeight;
  inputEl.focus();
}
