# backend/model_graph.py
import copy
from typing import Dict, List, Literal
from pydantic import BaseModel

NodeType = Literal["stock", "aux", "parameter"]


class Node(BaseModel):
    id: str
    label: str
    type: NodeType
    initial_value: float = 0.0


class Edge(BaseModel):
    source: str
    target: str
    sign: int = 1   # +1 or -1
    weight: float = 1.0


class ModelGraph:
    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []

    # ── bulk setters ──────────────────────────────────────────
    def set_nodes(self, nodes: List[Node]):
        self.nodes = {n.id: n for n in nodes}

    def set_edges(self, edges: List[Edge]):
        self.edges = list(edges)

    # ── granular mutations (used by the agent) ────────────────
    def add_node(self, node: Node):
        """Add or overwrite a node by id."""
        self.nodes[node.id] = node

    def remove_node(self, node_id: str) -> bool:
        """Remove a node and any edges touching it."""
        existed = node_id in self.nodes
        self.nodes.pop(node_id, None)
        self.edges = [
            e for e in self.edges
            if e.source != node_id and e.target != node_id
        ]
        return existed

    def add_edge(self, edge: Edge):
        self.edges.append(edge)

    def remove_edge(self, source: str, target: str) -> bool:
        before = len(self.edges)
        self.edges = [
            e for e in self.edges
            if not (e.source == source and e.target == target)
        ]
        return len(self.edges) < before

    # ── serialization + history support ───────────────────────
    def to_dict(self) -> dict:
        return {
            "nodes": [n.model_dump() for n in self.nodes.values()],
            "edges": [e.model_dump() for e in self.edges],
        }

    def load_dict(self, data: dict):
        """Replace the whole graph from a dict (used by undo/redo)."""
        self.nodes = {n["id"]: Node(**n) for n in data.get("nodes", [])}
        self.edges = [Edge(**e) for e in data.get("edges", [])]

    def snapshot(self) -> dict:
        """A deep, independent copy of the current state for the undo stack."""
        return copy.deepcopy(self.to_dict())
