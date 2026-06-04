# backend/presets.py
from typing import List
from .model_graph import ModelGraph, Node, Edge


def build_euromotion_preset() -> ModelGraph:
    g = ModelGraph()

    nodes: List[Node] = [
        Node(id="chip_inventory", label="Chip inventory", type="stock", initial_value=800.0),
        Node(id="backlog", label="OEM backlog", type="stock", initial_value=0.0),
        Node(id="trust", label="OEM trust", type="stock", initial_value=0.8),

        Node(id="chip_inventory_in", label="Chip inventory inflow", type="aux"),
        Node(id="chip_inventory_out", label="Chip inventory outflow", type="aux"),

        Node(id="backlog_in", label="Backlog inflow (orders)", type="aux"),
        Node(id="backlog_out", label="Backlog outflow (shipments)", type="aux"),

        Node(id="base_order_rate", label="Base order rate", type="parameter", initial_value=100.0),
        Node(id="prod_capacity", label="Production capacity", type="parameter", initial_value=120.0),
        Node(id="safety_factor", label="Safety factor", type="parameter", initial_value=4.0),
        Node(id="lead_time", label="Lead time", type="parameter", initial_value=8.0),
        Node(id="supplier_reliability", label="Supplier reliability", type="parameter", initial_value=0.9),
    ]
    g.set_nodes(nodes)

    edges: List[Edge] = [
        Edge(source="base_order_rate", target="backlog_in", sign=1, weight=1.0),
        Edge(source="trust", target="backlog_in", sign=1, weight=20.0),
        Edge(source="backlog", target="backlog_out", sign=1, weight=0.5),
        Edge(source="backlog_out", target="chip_inventory_out", sign=1, weight=1.0),
        Edge(source="safety_factor", target="chip_inventory_in", sign=1, weight=5.0),
        Edge(source="lead_time", target="chip_inventory_in", sign=-1, weight=1.0),
        Edge(source="supplier_reliability", target="chip_inventory_in", sign=1, weight=10.0),
        Edge(source="backlog", target="trust", sign=-1, weight=0.001),
    ]
    g.set_edges(edges)

    return g
