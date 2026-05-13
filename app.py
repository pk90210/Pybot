from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import anthropic
import json
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

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


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    messages = data.get("messages", [])

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    def generate():
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
