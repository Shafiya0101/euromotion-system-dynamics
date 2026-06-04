# EuroMotion System Dynamics

Interactive supply-chain simulator with an AI agent that edits the model from
natural language. **FastAPI** backend (a generic stock-and-flow simulator) +
**React/Vite** frontend (sliders, live chart, interactive graph, chat).

The AI agent can **add** parameters / stocks / connections, **remove** them, and
the whole thing supports **undo / redo / reset**.

---

## How it works

- **Stocks** integrate `inflow − outflow` over time. A stock `X` reads its flows
  from two auxiliary nodes named exactly `X_in` and `X_out`.
- **Auxiliary** nodes = sum of `sign × weight × source_value` over incoming edges.
- **Parameters** are constants you can tune with the sliders.
- The simulator is generic, so anything the agent adds is simulated automatically,
  and any new parameter/stock gets a slider in the UI automatically.

## Run locally

**Backend** (Python 3.10+):
```bash
pip install -r requirements.txt
# set your free Mistral key (https://console.mistral.ai/)
export MISTRAL_API_KEY=your-key          # Windows PowerShell: $env:MISTRAL_API_KEY="your-key"
uvicorn backend.main:app --reload --port 8000
```

**Frontend** (Node 18+):
```bash
cd frontend
cp .env.example .env          # leave VITE_API_BASE=http://localhost:8000 for local
npm install
npm run dev                   # opens http://localhost:5173
```

## The AI agent

Type instructions in the chat panel. Examples:

- `Add a cost parameter at 50 that reduces trust`
- `Add a warehouse stock`
- `Set base order rate to 150`
- `Remove the lead time parameter`
- `Undo that` / `Reset`

You can also use the **↶ Undo / ↷ Redo / ⟲ Reset** buttons in the top bar.

## API

| Method | Path                 | Purpose                                  |
|--------|----------------------|------------------------------------------|
| GET    | `/graph`             | Current model graph                      |
| POST   | `/simulate`          | Run a simulation (`dt`, `horizon`, `params`) |
| POST   | `/agent`             | Natural-language model edits             |
| POST   | `/undo` `/redo`      | Step through change history              |
| POST   | `/reset`             | Reload the default EuroMotion model      |

## Environment variables (backend)

| Var               | Default                                   | Notes                                  |
|-------------------|-------------------------------------------|----------------------------------------|
| `AI_PROVIDER`     | `mistral`                                 | `mistral` or `openai`                  |
| `MISTRAL_API_KEY` | —                                         | required if provider is mistral        |
| `OPENAI_API_KEY`  | —                                         | required if provider is openai         |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | comma-separated; `*` allows all    |

## Deploy


