const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let history = [];
let isStreaming = false;

// Configure marked
marked.setOptions({ breaks: true, gfm: true });

// Topic buttons
document.querySelectorAll('.topic-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q;
    if (q && !isStreaming) sendMessage(q);
  });
});

// Keyboard shortcut
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-grow textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
  const html = marked.parse(text);
  return html;
}

function addCodeHeaders(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-header')) return;
    const code = pre.querySelector('code');
    const lang = code?.className?.replace('language-', '') || 'python';
    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span>${lang}</span>
      <button class="copy-btn" onclick="copyCode(this)">Copy</button>
    `;
    pre.insertBefore(header, pre.firstChild);
    if (code) {
      hljs.highlightElement(code);
    }
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
  const welcome = document.querySelector('.welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
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
  bubble.innerHTML = `
    <div class="typing-indicator">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  `;
  return bubble;
}

async function sendMessage(overrideText) {
  const text = overrideText || inputEl.value.trim();
  if (!text || isStreaming) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;

  // Show user message
  const userBubble = createMessage('user');
  userBubble.textContent = text;
  history.push({ role: 'user', content: text });

  // Show typing indicator
  const botBubble = showTyping();

  let fullText = '';

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          const { text: chunk } = JSON.parse(payload);
          fullText += chunk;
          botBubble.innerHTML = renderMarkdown(fullText);
          addCodeHeaders(botBubble);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch {}
      }
    }

    // Final render pass
    botBubble.innerHTML = renderMarkdown(fullText);
    addCodeHeaders(botBubble);
    history.push({ role: 'assistant', content: fullText });

  } catch (err) {
    botBubble.innerHTML = `<span style="color:#e26060">⚠ ${err.message || 'Something went wrong. Is the server running?'}</span>`;
  }

  isStreaming = false;
  sendBtn.disabled = false;
  messagesEl.scrollTop = messagesEl.scrollHeight;
  inputEl.focus();
}

function clearChat() {
  history = [];
  messagesEl.innerHTML = `
    <div class="welcome">
      <div class="welcome-snake">🐍</div>
      <h2>What would you like to learn today?</h2>
      <p>Ask me anything about Python — from print("Hello, World!") to advanced async patterns.</p>
    </div>
  `;
}
