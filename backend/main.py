# backend/main.py
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .model_graph import ModelGraph, Node, Edge
from .simulator import GraphSimulator
from .presets import build_euromotion_preset

import os
import json

# ── AI provider setup ─────────────────────────────────────────
AI_PROVIDER = os.getenv("AI_PROVIDER", "mistral").lower()
client = None

try:
    if AI_PROVIDER == "mistral":
        from mistralai import Mistral
        api_key = os.getenv("MISTRAL_API_KEY")
        if api_key:
            client = Mistral(api_key=api_key)
            print("✅ Using Mistral AI")
        else:
            print("⚠️  MISTRAL_API_KEY not set.")
    elif AI_PROVIDER == "openai":
        from openai import OpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            client = OpenAI(api_key=api_key)
            print("✅ Using OpenAI")
        else:
            print("⚠️  OPENAI_API_KEY not set")
except ImportError as e:
    print(f"⚠️  Package not installed: {e}")

if client is None:
    print("⚠️  AI features disabled. Set MISTRAL_API_KEY (or OPENAI_API_KEY) to enable chat.")

app = FastAPI(title="EuroMotion SD Backend")

# ── CORS ──────────────────────────────────────────────────────
# Set ALLOWED_ORIGINS in your host as a comma-separated list, e.g.
#   https://your-app.vercel.app,https://www.your-domain.com
# Use "*" to allow everything (fine for a public demo).
_default_origins = "http://localhost:5173,http://localhost:3000"
_origins_env = os.getenv("ALLOWED_ORIGINS", _default_origins)
allow_origins = ["*"] if _origins_env.strip() == "*" else [
    o.strip() for o in _origins_env.split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory graph + undo/redo history ───────────────────────
graph: ModelGraph = build_euromotion_preset()
undo_stack: List[dict] = []   # past states (most recent last)
redo_stack: List[dict] = []   # states we undid (for redo)
MAX_HISTORY = 50


def push_history():
    """Snapshot the CURRENT graph before mutating it, and clear redo."""
    undo_stack.append(graph.snapshot())
    if len(undo_stack) > MAX_HISTORY:
        undo_stack.pop(0)
    redo_stack.clear()


def _undo() -> dict:
    if not undo_stack:
        return graph.to_dict()
    redo_stack.append(graph.snapshot())
    graph.load_dict(undo_stack.pop())
    return graph.to_dict()


def _redo() -> dict:
    if not redo_stack:
        return graph.to_dict()
    undo_stack.append(graph.snapshot())
    graph.load_dict(redo_stack.pop())
    return graph.to_dict()


# ── request / response models ─────────────────────────────────
class GraphPayload(BaseModel):
    nodes: List[Node]
    edges: List[Edge]


class SimRequest(BaseModel):
    dt: float = 1.0
    horizon: float = 260.0
    params: Optional[Dict[str, Any]] = None


class AgentRequest(BaseModel):
    instruction: str
    params: Optional[Dict[str, Any]] = None
    current_graph: Optional[Dict[str, Any]] = None


class AgentResponse(BaseModel):
    message: str
    action: str = "modify"
    new_params: Optional[Dict[str, Any]] = None
    graph: Optional[Dict[str, Any]] = None
    can_undo: bool = False
    can_redo: bool = False


# ── basic endpoints ───────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status": "EuroMotion SD Backend running",
        "ai_provider": AI_PROVIDER,
        "ai_ready": client is not None,
        "can_undo": len(undo_stack) > 0,
        "can_redo": len(redo_stack) > 0,
    }


@app.get("/graph")
def get_graph():
    return graph.to_dict()


@app.post("/graph")
def set_graph(payload: GraphPayload):
    push_history()
    graph.set_nodes(payload.nodes)
    graph.set_edges(payload.edges)
    return {"status": "ok", "graph": graph.to_dict()}


@app.post("/preset/euromotion")
def load_euromotion():
    global graph
    push_history()
    graph = build_euromotion_preset()
    return graph.to_dict()


@app.post("/reset")
def reset():
    global graph
    push_history()
    graph = build_euromotion_preset()
    return {"status": "ok", "graph": graph.to_dict()}


@app.post("/undo")
def undo():
    return {"status": "ok", "graph": _undo(),
            "can_undo": len(undo_stack) > 0, "can_redo": len(redo_stack) > 0}


@app.post("/redo")
def redo():
    return {"status": "ok", "graph": _redo(),
            "can_undo": len(undo_stack) > 0, "can_redo": len(redo_stack) > 0}


@app.post("/simulate")
def simulate(req: SimRequest):
    sim = GraphSimulator(
        graph=graph,
        dt=req.dt,
        horizon=req.horizon,
        params=req.params or {},
    )
    return sim.run()


# ── the AI agent ──────────────────────────────────────────────
AGENT_SYSTEM = """You are an AI systems engineer editing a system dynamics model.

Current model graph:
{graph}

Current parameter values:
{params}

User request: {instruction}

Decide what the user wants, then return ONLY valid JSON with this schema:
{{
  "message": "<one short sentence explaining what you did, for the user>",
  "action": "modify" | "undo" | "redo" | "reset",
  "new_params": {{ "<id>": <number> }},
  "add_nodes": [ {{ "id": "...", "label": "...", "type": "stock|aux|parameter", "initial_value": <number> }} ],
  "add_edges": [ {{ "source": "...", "target": "...", "sign": 1, "weight": 1.0 }} ],
  "remove_node_ids": [ "<id>" ],
  "remove_edges": [ {{ "source": "...", "target": "..." }} ]
}}

Rules:
- If the user wants to undo / revert / go back / "remove what you just added" generically -> action = "undo".
- If they want to redo -> action = "redo". If they want to start over / reset -> action = "reset".
- Otherwise action = "modify" and fill only the keys you need; omit the rest.
- To ADD a parameter the user names: add a node with type "parameter" and a sensible initial_value. If it should influence the model, also add an edge from it to the relevant "<stock>_in" or "<stock>_out" aux node (sign 1 to increase, -1 to decrease).
- To ADD a new stock called X: also add aux nodes "X_in" and "X_out" (the simulator reads inflow/outflow from those exact ids).
- To REMOVE things the user no longer wants: list ids in "remove_node_ids" and/or pairs in "remove_edges".
- Valid node types: "stock", "aux", "parameter". Valid edge sign: 1 or -1.
- Only change what was explicitly requested. Keep ids lowercase_with_underscores.

Return ONLY the JSON object, no prose, no markdown fences."""


def _call_llm(prompt: str) -> str:
    if AI_PROVIDER == "mistral":
        resp = client.chat.complete(
            model="mistral-small-latest",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return resp.choices[0].message.content
    elif AI_PROVIDER == "openai":
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return resp.choices[0].message.content
    raise HTTPException(status_code=500, detail=f"Unknown AI provider: {AI_PROVIDER}")


@app.post("/agent", response_model=AgentResponse)
def agent(req: AgentRequest):
    global graph
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="AI not configured. Set MISTRAL_API_KEY (free key at "
                   "https://console.mistral.ai/) or OPENAI_API_KEY.",
        )

    prompt = AGENT_SYSTEM.format(
        graph=json.dumps(graph.to_dict(), indent=2),
        params=json.dumps(req.params or {}, indent=2),
        instruction=req.instruction,
    )

    try:
        data = json.loads(_call_llm(prompt))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {e}")

    action = (data.get("action") or "modify").lower()
    message = data.get("message") or "Done."

    # History actions need no graph editing
    if action == "undo":
        return AgentResponse(message=message or "Reverted the last change.",
                             action="undo", graph=_undo(),
                             can_undo=len(undo_stack) > 0, can_redo=len(redo_stack) > 0)
    if action == "redo":
        return AgentResponse(message=message or "Reapplied the change.",
                             action="redo", graph=_redo(),
                             can_undo=len(undo_stack) > 0, can_redo=len(redo_stack) > 0)
    if action == "reset":
        push_history()
        graph = build_euromotion_preset()
        return AgentResponse(message=message or "Reset to the default model.",
                             action="reset", graph=graph.to_dict(),
                             can_undo=len(undo_stack) > 0, can_redo=len(redo_stack) > 0)

    # action == "modify": snapshot first so this is undoable
    push_history()
    try:
        for n in (data.get("add_nodes") or []):
            graph.add_node(Node(**n))
        for e in (data.get("add_edges") or []):
            graph.add_edge(Edge(**e))
        for nid in (data.get("remove_node_ids") or []):
            graph.remove_node(nid)
        for e in (data.get("remove_edges") or []):
            graph.remove_edge(e["source"], e["target"])
        # backward compatibility with the old schema
        for n in (data.get("new_nodes") or []):
            graph.add_node(Node(**n))
        for e in (data.get("new_edges") or []):
            graph.add_edge(Edge(**e))
    except Exception as e:
        _undo()  # roll back the partial change we just snapshotted
        raise HTTPException(status_code=500, detail=f"Could not apply changes: {e}")

    return AgentResponse(
        message=message,
        action="modify",
        new_params=data.get("new_params"),
        graph=graph.to_dict(),
        can_undo=len(undo_stack) > 0,
        can_redo=len(redo_stack) > 0,
    )
