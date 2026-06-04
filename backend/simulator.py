# backend/simulator.py
from typing import Dict, Any
from .model_graph import ModelGraph


class GraphSimulator:
    """
    Generic simulator with parameter override support:
    - stocks integrate inflow - outflow
    - aux nodes = linear combination of their inputs (sign * weight * source_value)
    - parameters can be overridden via params dict
    """

    def __init__(self, graph: ModelGraph, dt: float, horizon: float, params: Dict[str, Any] = None):
        self.graph = graph
        self.dt = dt
        self.horizon = horizon
        self.params = params or {}

    def run(self) -> Dict[str, Any]:
        time = []
        values = {nid: [] for nid in self.graph.nodes}

        # Initialize state with overrides from params
        state = {}
        for nid, node in self.graph.nodes.items():
            if nid in self.params:
                # Override from request params
                state[nid] = float(self.params[nid])
            else:
                state[nid] = node.initial_value

        t = 0.0
        while t <= self.horizon:
            time.append(t)
            for nid in self.graph.nodes:
                values[nid].append(state[nid])

            # Compute aux values and stock derivatives
            aux_values: Dict[str, float] = {}
            derivatives: Dict[str, float] = {
                nid: 0.0 for nid, n in self.graph.nodes.items() if n.type == "stock"
            }

            # Aux nodes = sum(sign * weight * source_value)
            for nid, node in self.graph.nodes.items():
                if node.type == "aux":
                    total = 0.0
                    for e in self.graph.edges:
                        if e.target == nid:
                            src_val = state.get(e.source, 0.0)
                            total += e.sign * e.weight * src_val
                    aux_values[nid] = total

            # Stock derivatives: inflow - outflow
            for nid, node in self.graph.nodes.items():
                if node.type == "stock":
                    inflow = aux_values.get(f"{nid}_in", 0.0)
                    outflow = aux_values.get(f"{nid}_out", 0.0)
                    derivatives[nid] = inflow - outflow

            # Integration step
            for nid, node in self.graph.nodes.items():
                if node.type == "stock":
                    state[nid] += derivatives[nid] * self.dt
                elif node.type == "aux":
                    state[nid] = aux_values.get(nid, state[nid])
                # Parameters stay constant

            t += self.dt

        return {"time": time, "values": values}