import React from 'react'
import { generateId } from '../util/id'
import { PackingScene } from '../viz/PackingScene'
import { useStore } from '../util/store'
import { centimeters } from '../util/units'

export function PackingUI() {
  const {
    boxCatalog,
    productCatalog,
    selectedBoxId,
    selectedProductIds,
    addBoxToCatalog,
    addRandomProductsToCatalog,
    toggleProductSelection,
    setSelectedProducts,
    setSelectedBoxId,
    chooseBestBoxAndPack,
    suggestedPlacements,
    suggestionIndex,
    confirmNextPlacement,
    goToPreviousSuggestion,
    statusMessage,
    resetAll,
  } = useStore()

  const [newBox, setNewBox] = React.useState({ w: 20, h: 15, d: 30 })
  const [qty, setQty] = React.useState(8)

  return (
    <>
      <aside className="sidebar">
        <div className="section col">
          <strong>Koli boyutları (cm)</strong>
          <div className="row">
            <input type="number" value={newBox.w} onChange={e => setNewBox(v => ({ ...v, w: Number(e.target.value) }))} placeholder="Genişlik" />
            <input type="number" value={newBox.d} onChange={e => setNewBox(v => ({ ...v, d: Number(e.target.value) }))} placeholder="Derinlik" />
            <input type="number" value={newBox.h} onChange={e => setNewBox(v => ({ ...v, h: Number(e.target.value) }))} placeholder="Yükseklik" />
            <button onClick={() => addBoxToCatalog({
              id: generateId(),
              widthCm: newBox.w,
              depthCm: newBox.d,
              heightCm: newBox.h,
            })}>Ekle</button>
          </div>
          <table>
            <thead>
              <tr><th>Genişlik</th><th>Derinlik</th><th>Yükseklik</th></tr>
            </thead>
            <tbody>
            </tbody>
          </table>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {boxCatalog.map(b => (
                  <tr key={b.id} onClick={() => setSelectedBoxId(b.id)} style={{ cursor: 'pointer', background: b.id === selectedBoxId ? 'rgba(91, 140, 255, .2)' : 'transparent' }}>
                    <td style={{ padding: '6px 8px' }}>{b.widthCm}</td>
                    <td style={{ padding: '6px 8px' }}>{b.depthCm}</td>
                    <td style={{ padding: '6px 8px' }}>{b.heightCm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section col">
          <strong>Ürün havuzu oluştur</strong>
          <div className="row">
            <input type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))} />
            <button onClick={() => addRandomProductsToCatalog(qty)}>Rastgele ekle</button>
          </div>
          <strong>Ürün seç</strong>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={selectedProductIds.length > 0 && selectedProductIds.length === productCatalog.length}
                ref={el => {
                  if (el) el.indeterminate = selectedProductIds.length > 0 && selectedProductIds.length < productCatalog.length
                }}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedProducts(productCatalog.map(p => p.id))
                  } else {
                    setSelectedProducts([])
                  }
                }}
              />
              Tümünü seç
            </label>
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th className="nowrap">Seç</th><th>Ad</th><th className="nowrap">Barkod</th><th className="nowrap">SKU</th><th className="nowrap">Genişlik</th><th className="nowrap">Derinlik</th><th className="nowrap">Yükseklik</th></tr>
              </thead>
              <tbody>
                {productCatalog.map(p => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={() => toggleProductSelection(p.id)}
                      />
                    </td>
                    <td>{p.name}</td>
                    <td className="nowrap">{p.barcode}</td>
                    <td className="nowrap">{p.sku}</td>
                    <td>{p.widthCm}</td>
                    <td>{p.depthCm}</td>
                    <td>{p.heightCm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section row">
          <button className="primary" onClick={chooseBestBoxAndPack}>Koli öner ve dizmek için tarif et</button>
          <button onClick={resetAll}>Sıfırla</button>
        </div>
      </aside>

      <section className="canvas-wrap">
        <PackingScene unitsPerCm={centimeters(1)} />
        {statusMessage && (
          <div className="floating-controls" style={{ top: 60 }}>
            <div style={{
              background: 'rgba(0,0,0,0.45)', padding: '8px 10px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)', maxWidth: 420
            }}>
              {statusMessage}
            </div>
          </div>
        )}
        {suggestedPlacements.length > 0 && suggestionIndex < suggestedPlacements.length && (() => {
          const next = suggestedPlacements[suggestionIndex]
          const prod = productCatalog.find(p => p.id === next.productId)
          return (
            <div className="floating-controls">
              <div style={{
                background: 'rgba(0,0,0,0.45)',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                display: 'flex',
                gap: 12,
                alignItems: 'center'
              }}>
                <div style={{ fontSize: 12 }}>
                  <div><strong>{prod?.name}</strong></div>
                  <div style={{ opacity: 0.8 }}>Barkod: {prod?.barcode}</div>
                  <div style={{ opacity: 0.8 }}>SKU: {prod?.sku}</div>
                  <div style={{ opacity: 0.8 }}>Boyut: {next.size.w}×{next.size.d}×{next.size.h} cm</div>
                </div>
                {suggestionIndex > 0 && (
                  <button onClick={goToPreviousSuggestion}>Önceki ürün</button>
                )}
                <button className="primary" onClick={confirmNextPlacement}>Yerleştirdim</button>
              </div>
            </div>
          )
        })()}
      </section>
    </>
  )
}


