import { create } from 'zustand'
import { generateId } from './id'

export type Box = {
  id: string
  widthCm: number
  depthCm: number
  heightCm: number
}

export type Product = {
  id: string
  name: string
  sku: string
  barcode: string
  widthCm: number
  depthCm: number
  heightCm: number
}

export type PlacedItem = {
  id: string
  productId: string
  // position in cm relative to box origin (bottom-left-back corner)
  x: number
  y: number
  z: number
  rotation: [number, number, number] // radians around x,y,z
  size: { w: number, d: number, h: number }
  color: string
}

type State = {
  // catalogs
  boxCatalog: Box[]
  productCatalog: Product[]
  // selections
  selectedProductIds: string[]
  selectedBoxId: string | null
  // packing result
  placedItems: PlacedItem[]
  // planned suggestions (ghosts) to place step-by-step
  suggestedPlacements: PlacedItem[]
  suggestionIndex: number
  statusMessage: string | null
  isWorking: boolean

  // actions
  addBoxToCatalog: (box: Box) => void
  addRandomProductsToCatalog: (count: number) => void
  toggleProductSelection: (productId: string) => void
  setSelectedProducts: (productIds: string[]) => void
  setSelectedBoxId: (boxId: string) => void
  chooseBestBoxAndPack: () => void
  confirmNextPlacement: () => void
  goToPreviousSuggestion: () => void
  resetAll: () => void
}

// Worker handles all packing logic now
const worker = new Worker(new URL('./packingWorker.ts', import.meta.url));

function generateBoxCatalog(targetCount: number): Box[] {
  const boxes: Box[] = []
  const seen = new Set<string>()

  const widths = [10, 12, 14, 15, 16, 18, 20, 22, 24, 25, 26, 28, 30, 32, 34, 35, 36, 38, 40, 42, 44, 45, 46, 48, 50, 52, 54, 55, 56, 58, 60]
  const depths = [10, 12, 14, 15, 16, 18, 20, 22, 24, 25, 26, 28, 30, 32, 34, 35, 36, 38, 40, 42, 44, 45, 46, 48, 50, 52, 54, 55, 56, 58, 60]
  const lowHeights = [5, 6, 7, 8, 9, 10]
  const midHeights = [12, 14, 15, 16, 18, 20]
  const highHeights = [22, 24, 25, 26, 28, 30, 32, 35]
  const tallHeights = [38, 40, 42, 45, 48, 50, 55, 60]

  const quotas = [
    { heights: lowHeights, count: 140 },   // 3-5 ürün civarı
    { heights: midHeights, count: 140 },   // 5-10 ürün
    { heights: highHeights, count: 140 },  // 10-20 ürün
    { heights: tallHeights, count: 80 },   // 20-50 ürün
  ]

  const pushBox = (w: number, d: number, h: number) => {
    if (boxes.length >= targetCount) return false
    const key = `${w}x${d}x${h}`
    if (seen.has(key)) return false
    seen.add(key)
    boxes.push({ id: `b-${key}`, widthCm: w, depthCm: d, heightCm: h })
    return true
  }

  // Pre-generate width/depth pairs using a deterministic round-robin to spread shapes
  const pairs: Array<{ w: number, d: number }> = []
  let i = 0
  while (pairs.length < targetCount * 3) { // oversample to avoid duplicates filtering
    const w = widths[(i * 7) % widths.length]
    const d = depths[(i * 11 + 3) % depths.length]
    if (w >= 8 && d >= 8) {
      pairs.push({ w, d })
      pairs.push({ w: d, d: w })
    }
    i++
  }

  let pIndex = 0
  for (const tier of quotas) {
    let added = 0
    let hIndex = 0
    while (added < tier.count && boxes.length < targetCount && pIndex < pairs.length) {
      const { w, d } = pairs[pIndex++]
      const h = tier.heights[hIndex % tier.heights.length]
      if (pushBox(w, d, h)) {
        added++
        hIndex++
      }
    }
  }

  // If still under target (due to duplicate filtering), fill with mixed tall/medium combos
  i = 0
  while (boxes.length < targetCount && i < pairs.length) {
    const { w, d } = pairs[i++]
    const allH = [...lowHeights, ...midHeights, ...highHeights, ...tallHeights]
    const h = allH[(i * 5) % allH.length]
    pushBox(w, d, h)
  }

  return boxes.slice(0, targetCount)
}

const initialBoxes: Box[] = generateBoxCatalog(500)

export const useStore = create<State>((set, get) => ({
  boxCatalog: initialBoxes,
  productCatalog: [],
  selectedProductIds: [],
  selectedBoxId: null,
  placedItems: [],
  suggestedPlacements: [],
  suggestionIndex: 0,
  statusMessage: null,
  isWorking: false,

  addBoxToCatalog: (box) => set(s => ({ boxCatalog: [...s.boxCatalog, box] })),
  addRandomProductsToCatalog: (count) => set(s => ({
    productCatalog: [
      ...s.productCatalog,
      ...Array.from({ length: count }).map(() => {
        // random product meta + size
        const names = [
          'Akıllı Saat', 'Ayakkabı', 'Bardak', 'Tablet', 'Telefon', 'Kulaklık', 'Kitap', 'Traş Makinesi', 'Powerbank', 'Oyuncak'
        ]
        const brands = ['Nova', 'ZenTech', 'Aurora', 'Vektor', 'Orion', 'Nimbus', 'Apex', 'Polar', 'Atlas', 'Vertex']
        const presets = [
          [12, 8, 2],   // kitap
          [18, 12, 8],  // traş makinesi
          [16, 8, 6],   // telefon kutusu
          [8, 8, 10],   // bardak
          [20, 15, 5],  // kulaklık kutusu
          [25, 20, 10], // oyuncak/ayakkabı
          [14, 14, 14], // küp ürün
          [22, 15, 3],  // tablet
          [10, 7, 3],   // powerbank
        ] as const
        const pick = presets[randomInt(0, presets.length - 1)]
        const jitter = () => randomInt(-1, 1)
        const w = Math.max(3, pick[0] + jitter())
        const d = Math.max(3, pick[1] + jitter())
        const h = Math.max(2, pick[2] + jitter())
        const name = `${brands[randomInt(0, brands.length - 1)]} ${names[randomInt(0, names.length - 1)]}`
        const sku = `SKU-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`
        const barcode = Array.from({ length: 13 }).map(() => String(randomInt(0, 9))).join('')
        return { id: generateId(), name, sku, barcode, widthCm: w, depthCm: d, heightCm: h }
      })
    ]
  })),
  setSelectedBoxId: (boxId) => set(() => ({ selectedBoxId: boxId })),
  toggleProductSelection: (productId) => set(s => ({
    selectedProductIds: s.selectedProductIds.includes(productId)
      ? s.selectedProductIds.filter(id => id !== productId)
      : [...s.selectedProductIds, productId]
  })),
  setSelectedProducts: (productIds) => set({ selectedProductIds: productIds }),
  chooseBestBoxAndPack: () => {
    const s = get()
    if (s.isWorking) return
    const selectedProducts = s.productCatalog.filter(p => s.selectedProductIds.includes(p.id))
    if (selectedProducts.length === 0) return
    set({ isWorking: true, statusMessage: 'Hesaplanıyor…' })
    
    // Watchdog timeout
    const watchdog = setTimeout(() => {
      set({ isWorking: false, statusMessage: 'Hesaplama uzun sürdü, lütfen tekrar deneyin.' })
    }, 60000)
    
    worker.postMessage({ type: 'pack', boxes: s.boxCatalog, products: selectedProducts })
    worker.onmessage = (e) => {
      // Clear watchdog when we get result
      clearTimeout(watchdog)
      
      const result = e.data
      if (!result) {
        set({ selectedBoxId: null, placedItems: [], suggestedPlacements: [], suggestionIndex: 0, statusMessage: 'Seçilen ürünler mevcut kolilere sığmıyor. Daha büyük bir koli ekleyin veya seçim sayısını azaltın.', isWorking: false })
        return
      }
      set({ selectedBoxId: result.box.id, placedItems: [], suggestedPlacements: result.placed, suggestionIndex: 0, statusMessage: null, isWorking: false })
    }
  },
  confirmNextPlacement: () => set(s => {
    if (s.suggestionIndex >= s.suggestedPlacements.length) return {}
    const next = s.suggestedPlacements[s.suggestionIndex]
    return {
      placedItems: [...s.placedItems, next],
      suggestionIndex: s.suggestionIndex + 1,
    }
  }),
  goToPreviousSuggestion: () => set(s => {
    if (s.suggestionIndex <= 0) return {}
    const prevIndex = s.suggestionIndex - 1
    const prev = s.suggestedPlacements[prevIndex]
    let placed = s.placedItems
    if (placed.length > 0 && placed[placed.length - 1]?.id === prev.id) {
      placed = placed.slice(0, placed.length - 1)
    }
    return {
      suggestionIndex: prevIndex,
      placedItems: placed,
    }
  }),
  resetAll: () => set({
    productCatalog: [], selectedProductIds: [], selectedBoxId: null, placedItems: [], suggestedPlacements: [], suggestionIndex: 0, statusMessage: null
  }),
}))

// Before generateBoxCatalog:
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// If shuffle is needed elsewhere, add it too, but currently only randomInt is missing.


