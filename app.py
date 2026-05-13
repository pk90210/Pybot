from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import anthropic
import json
import os
import sqlite3
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")

DB_PATH = "tutor.db"

SYSTEM_PROMPT = """You are an expert Python tutor. Your job is to teach Python clearly, concisely, and engagingly to learners of all levels.

Guidelines:
- Always provide working, well-commented code examples when relevant
- Explain concepts step by step — start simple, build up
- Use analogies to make abstract ideas concrete
- When showing code, wrap it in triple backticks with python language tag
- Encourage the learner and be positive
- If asked for a challenge, provide a clear problem statement and a hint, but not the full solution
- Keep responses focused — clarity over comprehensiveness
- Format inline code with backticks"""

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT 'New conversation',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content         TEXT NOT NULL,
                created_at      TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, id);
        """)


init_db()


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def now_iso():
    return datetime.utcnow().isoformat()


def make_title(text: str) -> str:
    """Derive a short title from the first user message."""
    return text[:60].strip() + ("..." if len(text) > 60 else "")


def get_conversation_messages(conv_id: str) -> list:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id",
            (conv_id,),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


# ---------------------------------------------------------------------------
# Routes - pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Routes - conversations CRUD
# ---------------------------------------------------------------------------

@app.route("/conversations", methods=["GET"])
def list_conversations():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/conversations", methods=["POST"])
def create_conversation():
    conv_id = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conv_id, "New conversation", ts, ts),
        )
    return jsonify({"id": conv_id, "title": "New conversation", "created_at": ts, "updated_at": ts}), 201


@app.route("/conversations/<conv_id>", methods=["GET"])
def get_conversation(conv_id):
    with get_db() as conn:
        conv = conn.execute(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?", (conv_id,)
        ).fetchone()
        if not conv:
            return jsonify({"error": "Not found"}), 404
        messages = conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id",
            (conv_id,),
        ).fetchall()
    return jsonify({"conversation": dict(conv), "messages": [dict(m) for m in messages]})


@app.route("/conversations/<conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    with get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    return jsonify({"deleted": conv_id})


# ---------------------------------------------------------------------------
# Routes - chat (streaming)
# ---------------------------------------------------------------------------

@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    user_message = data.get("message", "").strip()
    conv_id = data.get("conversation_id")

    if not user_message:
        return jsonify({"error": "No message provided"}), 400

    ts = now_iso()

    with get_db() as conn:
        if not conv_id:
            # Auto-create conversation on first message
            conv_id = str(uuid.uuid4())
            title = make_title(user_message)
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (conv_id, title, ts, ts),
            )
        else:
            row = conn.execute("SELECT id FROM conversations WHERE id = ?", (conv_id,)).fetchone()
            if not row:
                return jsonify({"error": "Conversation not found"}), 404
            # Set title from first message if conversation is still empty
            existing = conn.execute(
                "SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?", (conv_id,)
            ).fetchone()
            if existing["cnt"] == 0:
                conn.execute(
                    "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                    (make_title(user_message), ts, conv_id),
                )

        # Persist user message
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (conv_id, "user", user_message, ts),
        )

    # Load full history for Claude
    history = get_conversation_messages(conv_id)

    def generate():
        full_reply = []

        # Send conversation_id first so the frontend can update the URL/state
        yield f"data: {json.dumps({'conversation_id': conv_id})}\n\n"

        try:
            with client.messages.stream(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=history,
            ) as stream:
                for text in stream.text_stream:
                    full_reply.append(text)
                    yield f"data: {json.dumps({'text': text})}\n\n"

        finally:
            # Persist assistant reply even on partial stream
            reply_text = "".join(full_reply)
            if reply_text:
                with get_db() as conn:
                    conn.execute(
                        "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                        (conv_id, "assistant", reply_text, now_iso()),
                    )
                    conn.execute(
                        "UPDATE conversations SET updated_at = ? WHERE id = ?",
                        (now_iso(), conv_id),
                    )

        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
