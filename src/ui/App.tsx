import React from 'react'
import { PackingUI } from './PackingUI'

export function App() {
  return (
    <div className="layout">
      <header>
        <div className="brand">
          <span style={{ width: 24, height: 24, background: '#5b8cff', borderRadius: 6, display: 'inline-block' }} />
          Koli Paketleme Simülasyonu
        </div>
      </header>
      <PackingUI />
    </div>
  )
}



