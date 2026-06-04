import { useState, useEffect, useCallback } from 'react'
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import './App.css'

// Configurable for deployment. Set VITE_API_BASE in a .env file or on your host.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const LINE_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f7f', '#33b5e5', '#a569bd', '#e67e22']

// Nice ranges for the original parameters; anything the AI adds falls back to "auto".
const KNOWN_RANGES = {
  backlog: { min: 0, max: 1000, step: 10 },
  chip_inventory: { min: 0, max: 2000, step: 50 },
  trust: { min: 0, max: 1, step: 0.01 },
  base_order_rate: { min: 0, max: 200, step: 5 },
  prod_capacity: { min: 0, max: 250, step: 5 },
  safety_factor: { min: 0, max: 20, step: 0.5 },
  lead_time: { min: 1, max: 20, step: 1 },
  supplier_reliability: { min: 0, max: 1, step: 0.05 },
}

const rangeFor = (id, value) => {
  if (KNOWN_RANGES[id]) return KNOWN_RANGES[id]
  const v = Math.abs(Number(value) || 0)
  const max = v <= 1 ? 1 : Math.max(10, Math.ceil(v * 2))
  const step = v <= 1 ? 0.01 : (max <= 50 ? 0.5 : 5)
  return { min: 0, max, step }
}

const getNodeStyle = (type) => {
  const base = {
    padding: '10px 20px', borderRadius: '8px', fontSize: '12px',
    fontWeight: '500', border: '2px solid', minWidth: '120px', textAlign: 'center'
  }
  switch (type) {
    case 'stock': return { ...base, background: '#e3f2fd', borderColor: '#1976d2', color: '#0d47a1' }
    case 'aux': return { ...base, background: '#f3e5f5', borderColor: '#7b1fa2', color: '#4a148c' }
    case 'parameter': return { ...base, background: '#fff3e0', borderColor: '#f57c00', color: '#e65100' }
    default: return base
  }
}

const KNOWN_POSITIONS = {
  chip_inventory: { x: 150, y: 50 }, backlog: { x: 450, y: 50 }, trust: { x: 750, y: 50 },
  chip_inventory_in: { x: 50, y: 200 }, chip_inventory_out: { x: 250, y: 200 },
  backlog_in: { x: 450, y: 200 }, backlog_out: { x: 650, y: 200 },
  base_order_rate: { x: 100, y: 350 }, prod_capacity: { x: 300, y: 350 },
  safety_factor: { x: 500, y: 350 }, lead_time: { x: 700, y: 350 },
  supplier_reliability: { x: 400, y: 500 },
}

// Build the params object (parameter + stock nodes) from a graph.
const paramsFromGraph = (data) => {
  const p = {}
  data.nodes.forEach(n => {
    if (n.type === 'parameter' || n.type === 'stock') p[n.id] = n.initial_value
  })
  return p
}

function App() {
  const [activeTab, setActiveTab] = useState('simulation')
  const [graphData, setGraphData] = useState(null)
  const [simResult, setSimResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  const [params, setParams] = useState({})

  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState([])
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => { loadGraph() }, [])

  // Auto-run simulation shortly after parameters change (debounced).
  useEffect(() => {
    if (!graphData || Object.keys(params).length === 0) return
    const t = setTimeout(() => runSimulation(), 250)
    return () => clearTimeout(t)
  }, [params, graphData])

  // Apply a graph received from the backend: update flow view + merge params.
  const applyGraph = (data) => {
    if (!data) return
    setGraphData(data)
    convertToReactFlowFormat(data)
    setParams(prev => {
      const base = paramsFromGraph(data)
      const merged = { ...base }
      // keep any value the user already tuned for ids that still exist
      Object.keys(base).forEach(k => { if (k in prev) merged[k] = prev[k] })
      return merged
    })
  }

  const refreshHistoryFlags = async () => {
    try {
      const r = await fetch(`${API_BASE}/`)
      const d = await r.json()
      setCanUndo(!!d.can_undo)
      setCanRedo(!!d.can_redo)
    } catch { /* ignore */ }
  }

  const loadGraph = async () => {
    try {
      const res = await fetch(`${API_BASE}/graph`)
      const data = await res.json()
      applyGraph(data)
      refreshHistoryFlags()
    } catch (err) {
      console.error('Failed to load graph:', err)
    }
  }

  const convertToReactFlowFormat = (data) => {
    let unknownIdx = 0
    const flowNodes = data.nodes.map((node) => {
      let pos = KNOWN_POSITIONS[node.id]
      if (!pos) {
        pos = { x: 100 + (unknownIdx % 6) * 180, y: 650 + Math.floor(unknownIdx / 6) * 120 }
        unknownIdx++
      }
      return {
        id: node.id,
        type: 'default',
        data: {
          label: (
            <div style={getNodeStyle(node.type)}>
              <div style={{ fontWeight: 'bold' }}>{node.label}</div>
              <div style={{ fontSize: '10px', marginTop: '4px' }}>
                {node.type === 'parameter' || node.type === 'stock'
                  ? `${node.initial_value}` : node.type}
              </div>
            </div>
          )
        },
        position: pos,
        style: { background: 'transparent', border: 'none' }
      }
    })

    const flowEdges = data.edges.map((edge, idx) => ({
      id: `e${idx}`,
      source: edge.source,
      target: edge.target,
      animated: true,
      label: `${edge.sign > 0 ? '+' : '-'}${edge.weight}`,
      labelStyle: { fill: edge.sign > 0 ? '#2e7d32' : '#c62828', fontWeight: 700 },
      style: { stroke: edge.sign > 0 ? '#4caf50' : '#f44336', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: edge.sign > 0 ? '#4caf50' : '#f44336' }
    }))

    setNodes(flowNodes)
    setEdges(flowEdges)
  }

  const runSimulation = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dt: 1.0, horizon: 260, params })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSimResult(await res.json())
    } catch (err) {
      console.error('Simulation failed:', err)
    }
    setLoading(false)
  }

  const handleParamChange = (key, value) => {
    setParams(prev => ({ ...prev, [key]: parseFloat(value) }))
  }

  // ── history controls ───────────────────────────────────────
  const historyAction = async (endpoint) => {
    try {
      const res = await fetch(`${API_BASE}/${endpoint}`, { method: 'POST' })
      const data = await res.json()
      if (data.graph) applyGraph(data.graph)
      setCanUndo(!!data.can_undo)
      setCanRedo(!!data.can_redo)
    } catch (err) {
      console.error(`${endpoint} failed:`, err)
    }
  }

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return
    const userMessage = chatInput
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }])
    setChatInput('')
    setChatLoading(true)

    try {
      const res = await fetch(`${API_BASE}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: userMessage, params, current_graph: graphData })
      })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'AI request failed')
      }
      const data = await res.json()
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.message }])

      if (data.graph) applyGraph(data.graph)
      if (data.new_params) setParams(prev => ({ ...prev, ...data.new_params }))
      if (typeof data.can_undo === 'boolean') setCanUndo(data.can_undo)
      if (typeof data.can_redo === 'boolean') setCanRedo(data.can_redo)
    } catch (err) {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}. Make sure the backend is running and an AI key is set.`
      }])
    }
    setChatLoading(false)
  }

  // ── derived data for the chart (all stocks, dynamic) ───────
  const stockNodes = graphData ? graphData.nodes.filter(n => n.type === 'stock') : []

  // For tiny fractional stocks (e.g. trust 0..1), scale by 100 so they're visible.
  const scaleInfo = {}
  stockNodes.forEach(n => {
    const series = simResult?.values?.[n.id] || []
    const maxAbs = series.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    scaleInfo[n.id] = (maxAbs > 0 && maxAbs <= 5) ? 100 : 1
  })

  const chartData = simResult ? simResult.time.map((t, i) => {
    const row = { time: Math.round(t) }
    stockNodes.forEach(n => {
      const v = simResult.values[n.id]?.[i] ?? 0
      row[n.id] = Math.round(v * scaleInfo[n.id] * 100) / 100
    })
    return row
  }) : []

  const stockEntries = graphData ? graphData.nodes.filter(n => n.type === 'stock') : []
  const paramEntries = graphData ? graphData.nodes.filter(n => n.type === 'parameter') : []

  const renderControl = (node) => {
    const id = node.id
    const value = params[id] ?? node.initial_value
    const { min, max, step } = rangeFor(id, value)
    return (
      <label key={id}>
        {node.label}: {Number(value).toFixed(step < 1 ? 2 : 0)}
        <input
          type="range" min={min} max={max} step={step}
          value={value}
          onChange={(e) => handleParamChange(id, e.target.value)}
        />
      </label>
    )
  }

  return (
    <div className="app-container">
      <header>
        <h1>🏭 EuroMotion System Dynamics</h1>
        <p>Interactive Supply Chain Simulator</p>
      </header>

      <div className="tab-navigation">
        <button className={activeTab === 'simulation' ? 'tab-active' : ''}
          onClick={() => setActiveTab('simulation')}>📊 Simulation Results</button>
        <button className={activeTab === 'graph' ? 'tab-active' : ''}
          onClick={() => setActiveTab('graph')}>🔗 Interactive Graph</button>

        {/* History controls */}
        <span style={{ flex: 1 }} />
        <button onClick={() => historyAction('undo')} disabled={!canUndo} title="Undo last change">↶ Undo</button>
        <button onClick={() => historyAction('redo')} disabled={!canRedo} title="Redo">↷ Redo</button>
        <button onClick={() => historyAction('reset')} title="Reset to default model">⟲ Reset</button>
      </div>

      <div className="main-layout">
        {/* Left Panel — dynamic controls */}
        <div className="left-panel">
          <div className="panel">
            <h2>Stock Initial Values</h2>
            <div className="slider-group">
              {stockEntries.length ? stockEntries.map(renderControl)
                : <p style={{ color: '#888' }}>Loading…</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Parameters</h2>
            <div className="slider-group">
              {paramEntries.length ? paramEntries.map(renderControl)
                : <p style={{ color: '#888' }}>Loading…</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Model Structure</h2>
            {graphData && (
              <div className="graph-info">
                <p><strong>Stocks:</strong></p>
                <ul>{stockEntries.map(n => <li key={n.id}>{n.label}</li>)}</ul>
                <p><strong>Parameters:</strong></p>
                <ul>{paramEntries.map(n => <li key={n.id}>{n.label}</li>)}</ul>
              </div>
            )}
          </div>
        </div>

        {/* Center Panel */}
        <div className="center-panel">
          {activeTab === 'simulation' ? (
            <div className="panel chart-panel">
              <h2>Simulation Results {loading && <span className="loading">⟳</span>}</h2>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={500}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time"
                      label={{ value: 'Time (weeks)', position: 'insideBottom', offset: -5 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {stockNodes.map((n, i) => (
                      <Line key={n.id} type="monotone" dataKey={n.id}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        name={scaleInfo[n.id] === 100 ? `${n.label} (×100)` : n.label}
                        strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="loading-message">
                  {loading ? 'Running simulation...' : 'Adjust parameters to run simulation...'}
                </div>
              )}
            </div>
          ) : (
            <div className="panel graph-panel">
              <h2>🔗 Interactive System Dynamics Graph</h2>
              <div className="graph-legend">
                <span className="legend-item stock">■ Stock</span>
                <span className="legend-item aux">■ Auxiliary</span>
                <span className="legend-item param">■ Parameter</span>
                <span className="legend-item pos">→ Positive (+)</span>
                <span className="legend-item neg">→ Negative (-)</span>
              </div>
              {nodes.length > 0 ? (
                <div style={{ height: '600px', border: '1px solid #ddd', borderRadius: '8px' }}>
                  <ReactFlow nodes={nodes} edges={edges}
                    onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                    onConnect={onConnect} fitView fitViewOptions={{ padding: 0.2 }}>
                    <Controls />
                    <MiniMap nodeColor={(node) => {
                      const nd = graphData?.nodes.find(n => n.id === node.id)
                      if (!nd) return '#999'
                      return nd.type === 'stock' ? '#1976d2' : nd.type === 'aux' ? '#7b1fa2' : '#f57c00'
                    }} />
                    <Background variant="dots" gap={12} size={1} />
                  </ReactFlow>
                </div>
              ) : <div className="loading-message">Loading graph...</div>}
            </div>
          )}
        </div>

        {/* Right Panel — AI Chat */}
        <div className="right-panel">
          <div className="panel chat-panel">
            <h2>🤖 AI Assistant</h2>
            <div className="chat-messages">
              {chatHistory.length === 0 && (
                <div className="chat-help">
                  <p><strong>Ask me to:</strong></p>
                  <ul>
                    <li>"Add a cost parameter at 50 that reduces trust"</li>
                    <li>"Add a warehouse stock"</li>
                    <li>"Set base order rate to 150"</li>
                    <li>"Remove the lead time parameter"</li>
                    <li>"Undo that"</li>
                  </ul>
                  <div className="api-warning">
                    ⚠️ The AI features need an API key set on the backend
                    (MISTRAL_API_KEY or OPENAI_API_KEY).
                  </div>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.role}`}>
                  <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong>
                  <p>{msg.content}</p>
                </div>
              ))}
              {chatLoading && (
                <div className="chat-message assistant">
                  <strong>AI:</strong><p className="typing">Thinking...</p>
                </div>
              )}
            </div>
            <div className="chat-input">
              <input type="text" value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Ask me to modify the model..." disabled={chatLoading} />
              <button onClick={sendChatMessage} disabled={chatLoading}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
