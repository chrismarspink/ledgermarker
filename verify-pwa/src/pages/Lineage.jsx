import React from 'react'
import { useParams } from 'react-router-dom'
import cytoscape from 'cytoscape'
import { api } from '../lib/api.js'

// 가계도 뷰: 조상·형제·자손 그래프 (DEV SPEC §8.1-6)
export default function LineagePage() {
  const { docGuid } = useParams()
  const ref = React.useRef()
  const [error, setError] = React.useState('')
  const [graph, setGraph] = React.useState(null)

  React.useEffect(() => {
    api.lineage(docGuid).then(setGraph).catch((e) => setError(e.message))
  }, [docGuid])

  React.useEffect(() => {
    if (!graph || !ref.current) return
    const short = (id) => id.slice(0, 8)
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...graph.nodes.map((n) => ({
          data: {
            id: n.docGuid,
            label: `${short(n.docGuid)}\n[${n.grade || '?'}]${n.revoked ? ' 폐기' : ''}`,
            target: n.docGuid === graph.target,
            revoked: n.revoked
          }
        })),
        ...graph.edges.map((e) => ({
          data: { source: e.from, target: e.to, label: e.transform || '' }
        }))
      ],
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle', width: 110, height: 48,
            'background-color': '#eef1f6', 'border-width': 1.5, 'border-color': '#1a2b4a',
            label: 'data(label)', 'text-wrap': 'wrap', 'text-valign': 'center',
            'font-size': 11, color: '#111827'
          }
        },
        { selector: 'node[?target]', style: { 'background-color': '#1a2b4a', color: '#fff' } },
        { selector: 'node[?revoked]', style: { 'border-color': '#b02a2a', 'border-style': 'dashed' } },
        {
          selector: 'edge',
          style: {
            width: 2, 'line-color': '#9aa4b2', 'target-arrow-shape': 'triangle',
            'target-arrow-color': '#9aa4b2', 'curve-style': 'bezier',
            label: 'data(label)', 'font-size': 10, color: '#6b7280'
          }
        }
      ],
      layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.3 }
    })
    return () => cy.destroy()
  }, [graph])

  return (
    <div>
      <h2>문서 가계도</h2>
      <div className="mono">대상 {docGuid} {graph?.rootDocId ? `· 최초 조상 ${graph.rootDocId}` : ''}</div>
      {error && <p className="error">{error}</p>}
      <div className="graph" ref={ref} />
      <p className="hint">실선 테두리: 유효 · 붉은 점선: 폐기됨 · 간선 라벨: 변환 종류(edit/convert/merge/extract)</p>
    </div>
  )
}
