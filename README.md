# 🐍 Python Tutor — Flask + Claude AI

An AI-powered Python tutoring chatbot with a Flask backend and streaming responses.

## Project Structure

```
python-tutor/
├── app.py                  # Flask backend
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Main HTML page
└── static/
    ├── css/
    │   └── style.css       # Styles
    └── js/
        └── app.js          # Frontend JS (SSE streaming, markdown rendering)
```

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Set your Anthropic API key

**Mac/Linux:**
```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

**Windows (CMD):**
```cmd
set ANTHROPIC_API_KEY=your_api_key_here
```

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="your_api_key_here"
```

Get your API key at: https://console.anthropic.com

### 3. Run the app

```bash
python app.py
```

Then open your browser and go to: **http://localhost:5000**

## Features

- 🤖 Powered by Claude claude-sonnet-4-20250514 via the Anthropic API
- ⚡ Real-time streaming responses (Server-Sent Events)
- 🎨 Syntax-highlighted Python code blocks with copy button
- 📚 10 quick-topic sidebar buttons
- 💬 Full conversation memory per session
- 🔄 New conversation button to reset chat

## API Key Security

Your API key lives only on the server (in `app.py` via environment variable) — it is never exposed to the browser. This makes it safe to share the app with others.
