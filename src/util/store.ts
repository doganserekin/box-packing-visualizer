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

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function volume(w: number, d: number, h: number) {
  return w * d * h
}

type Orientation = { w: number, d: number, h: number, rot: [number, number, number] }

function orientationsOf(p: Product): Orientation[] {
  const dims = [p.widthCm, p.depthCm, p.heightCm]
  const perms = new Set<string>()
  const out: Orientation[] = []
  const combos: [number, number, number][] = [
    [dims[0], dims[1], dims[2]],
    [dims[0], dims[2], dims[1]],
    [dims[1], dims[0], dims[2]],
    [dims[1], dims[2], dims[0]],
    [dims[2], dims[0], dims[1]],
    [dims[2], dims[1], dims[0]],
  ]
  combos.forEach((c) => {
    const key = c.join('x')
    if (!perms.has(key)) {
      perms.add(key)
      // Görselde rotasyonu uygulamayacağız; boyutları direkt kullanacağız
      out.push({ w: c[0], d: c[1], h: c[2], rot: [0, 0, 0] })
    }
  })
  return out
}

function canPlaceAt(x: number, y: number, z: number, size: { w: number, d: number, h: number }, box: Box, placed: PlacedItem[]) {
  // bounds check
  if (x < 0 || y < 0 || z < 0) return false
  if (x + size.w > box.widthCm) return false
  if (y + size.h > box.heightCm) return false
  if (z + size.d > box.depthCm) return false
  // collision check AABB
  for (const it of placed) {
    const overlapX = x < it.x + it.size.w && x + size.w > it.x
    const overlapY = y < it.y + it.size.h && y + size.h > it.y
    const overlapZ = z < it.z + it.size.d && z + size.d > it.z
    if (overlapX && overlapY && overlapZ) {
      return false
    }
  }
  return true
}

function nextPlacementAnchors(placed: PlacedItem[], box: Box): Array<{ x: number, y: number, z: number }> {
  // heuristic: start from corners of already placed items + origin
  const anchors: Array<{ x: number, y: number, z: number }> = [{ x: 0, y: 0, z: 0 }]
  for (const it of placed) {
    // faces
    anchors.push({ x: it.x + it.size.w, y: it.y, z: it.z })
    anchors.push({ x: it.x, y: it.y + it.size.h, z: it.z })
    anchors.push({ x: it.x, y: it.y, z: it.z + it.size.d })
    // edges/corners around the item
    anchors.push({ x: it.x + it.size.w, y: it.y, z: it.z + it.size.d })
    anchors.push({ x: it.x, y: it.y + it.size.h, z: it.z + it.size.d })
    anchors.push({ x: it.x + it.size.w, y: it.y + it.size.h, z: it.z })
    anchors.push({ x: it.x + it.size.w, y: it.y + it.size.h, z: it.z + it.size.d })
  }
  // keep anchors inside box
  const inside = anchors.filter(a => a.x <= box.widthCm && a.y <= box.heightCm && a.z <= box.depthCm)
  // prefer near-origin anchors to tighten packing
  inside.sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z))
  // remove duplicates
  const uniq: typeof inside = []
  const seen = new Set<string>()
  for (const a of inside) {
    const key = `${a.x}|${a.y}|${a.z}`
    if (!seen.has(key)) { seen.add(key); uniq.push(a) }
  }
  return uniq
}

function overlaps1D(aStart: number, aLen: number, bStart: number, bLen: number) {
  return aStart < bStart + bLen && aStart + aLen > bStart
}

function supportHeight(x: number, z: number, size: { w: number, d: number }, placed: PlacedItem[]) {
  let support = 0
  for (const it of placed) {
    const xOverlap = overlaps1D(x, size.w, it.x, it.size.w)
    const zOverlap = overlaps1D(z, size.d, it.z, it.size.d)
    if (xOverlap && zOverlap) {
      support = Math.max(support, it.y + it.size.h)
    }
  }
  return support
}

// Check if the entire footprint [x,x+w) x [z,z+d) is fully covered by items whose top equals requiredY
function hasFullSupport(x: number, z: number, w: number, d: number, requiredY: number, placed: PlacedItem[]): boolean {
  if (requiredY === 0) return true
  const x0 = x, x1 = x + w
  const z0 = z, z1 = z + d
  const belowRects = placed
    .filter(it => it.y + it.size.h === requiredY)
    .map(it => ({
      x0: it.x,
      x1: it.x + it.size.w,
      z0: it.z,
      z1: it.z + it.size.d,
    }))
    .filter(r => r.x1 > x0 && r.x0 < x1 && r.z1 > z0 && r.z0 < z1)
  if (belowRects.length === 0) return false
  const xCuts = Array.from(new Set([x0, x1, ...belowRects.flatMap(r => [Math.max(x0, Math.min(x1, r.x0)), Math.max(x0, Math.min(x1, r.x1))])])).sort((a, b) => a - b)
  const zCuts = Array.from(new Set([z0, z1, ...belowRects.flatMap(r => [Math.max(z0, Math.min(z1, r.z0)), Math.max(z0, Math.min(z1, r.z1))])])).sort((a, b) => a - b)
  for (let i = 0; i < xCuts.length - 1; i++) {
    for (let j = 0; j < zCuts.length - 1; j++) {
      const xa = xCuts[i], xb = xCuts[i + 1]
      const za = zCuts[j], zb = zCuts[j + 1]
      const area = (xb - xa) * (zb - za)
      if (area <= 0) continue
      const cx = (xa + xb) / 2
      const cz = (za + zb) / 2
      const covered = belowRects.some(r => cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1)
      if (!covered) return false
    }
  }
  return true
}

function bestContactX(curX: number, y: number, z: number, size: { w: number, d: number, h: number }, box: Box, placed: PlacedItem[]) {
  const candidates: number[] = [0]
  for (const it of placed) {
    const yOverlap = overlaps1D(y, size.h, it.y, it.size.h)
    const zOverlap = overlaps1D(z, size.d, it.z, it.size.d)
    if (yOverlap && zOverlap) {
      const c = it.x + it.size.w
      if (c <= curX) candidates.push(c)
    }
  }
  candidates.sort((a, b) => b - a)
  for (const x of candidates) {
    if (canPlaceAt(x, y, z, size, box, placed)) return x
  }
  return curX
}

function bestContactZ(x: number, y: number, curZ: number, size: { w: number, d: number, h: number }, box: Box, placed: PlacedItem[]) {
  const candidates: number[] = [0]
  for (const it of placed) {
    const xOverlap = overlaps1D(x, size.w, it.x, it.size.w)
    const yOverlap = overlaps1D(y, size.h, it.y, it.size.h)
    if (xOverlap && yOverlap) {
      const c = it.z + it.size.d
      if (c <= curZ) candidates.push(c)
    }
  }
  candidates.sort((a, b) => b - a)
  for (const z of candidates) {
    if (canPlaceAt(x, y, z, size, box, placed)) return z
  }
  return curZ
}

function computeContactScore(rect: { x: number, z: number, w: number, d: number }, box: Box, placed: PlacedItem[], layerY: number) {
  let score = 0
  // wall contacts
  if (rect.x === 0) score += rect.d
  if (rect.z === 0) score += rect.w
  if (rect.x + rect.w === box.widthCm) score += rect.d
  if (rect.z + rect.d === box.depthCm) score += rect.w
  // neighbor contacts along x edges
  for (const it of placed) {
    if (it.y !== layerY) continue
    const zOverlap = overlaps1D(rect.z, rect.d, it.z, it.size.d)
    if (zOverlap) {
      if (rect.x === it.x + it.size.w) score += Math.min(rect.d, it.size.d)
      if (rect.x + rect.w === it.x) score += Math.min(rect.d, it.size.d)
    }
    const xOverlap = overlaps1D(rect.x, rect.w, it.x, it.size.w)
    if (xOverlap) {
      if (rect.z === it.z + it.size.d) score += Math.min(rect.w, it.size.w)
      if (rect.z + rect.d === it.z) score += Math.min(rect.w, it.size.w)
    }
  }
  return score
}

function compactPosition(pos: { x: number, y: number, z: number }, size: { w: number, d: number, h: number }, box: Box, placed: PlacedItem[]) {
  let x = Math.max(0, Math.min(pos.x, box.widthCm - size.w))
  let z = Math.max(0, Math.min(pos.z, box.depthCm - size.d))
  let y = Math.max(0, Math.min(pos.y, box.heightCm - size.h))

  let changed = true
  let iter = 0
  while (changed && iter < 6) {
    iter++
    changed = false
    // drop to support surface
    const newY = supportHeight(x, z, { w: size.w, d: size.d }, placed)
    if (newY !== y) { y = newY; changed = true }

    const nx = bestContactX(x, y, z, size, box, placed)
    if (nx !== x) { x = nx; changed = true }

    // after x change, recompute support again
    const newY2 = supportHeight(x, z, { w: size.w, d: size.d }, placed)
    if (newY2 !== y) { y = newY2; changed = true }

    const nz = bestContactZ(x, y, z, size, box, placed)
    if (nz !== z) { z = nz; changed = true }
  }

  // final bounds clamp
  x = Math.max(0, Math.min(x, box.widthCm - size.w))
  y = Math.max(0, Math.min(y, box.heightCm - size.h))
  z = Math.max(0, Math.min(z, box.depthCm - size.d))

  return { x, y, z }
}

function greedyPack(products: Product[], box: Box): PlacedItem[] | null {
  const placed: PlacedItem[] = []
  const colors = [
    '#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f'
  ]
  const items = [...products].sort((a, b) => volume(b.widthCm, b.depthCm, b.heightCm) - volume(a.widthCm, a.depthCm, a.heightCm))

  for (let idx = 0; idx < items.length; idx++) {
    const prod = items[idx]
    let placedThis: PlacedItem | null = null
    const candidates = nextPlacementAnchors(placed, box)
    const orientations = orientationsOf(prod)
    outer: for (const anchor of candidates) {
      for (const ori of orientations) {
        // compact from the anchor into stable contact configuration
        const compacted = compactPosition({ x: anchor.x, y: anchor.y, z: anchor.z }, { w: ori.w, d: ori.d, h: ori.h }, box, placed)
        if (!canPlaceAt(compacted.x, compacted.y, compacted.z, { w: ori.w, d: ori.d, h: ori.h }, box, placed)) continue
        // require full support for any y>0 to avoid overhangs/hovering
        if (!hasFullSupport(compacted.x, compacted.z, ori.w, ori.d, compacted.y, placed)) continue
        // strong validity: require full support (either taban zemini y=0 veya altında tam çakışma olmayabilir; şimdilik y değeri kompaksiyon sonucu kabul)
        placedThis = {
          id: generateId(),
          productId: prod.id,
          x: compacted.x,
          y: compacted.y,
          z: compacted.z,
          rotation: ori.rot,
          size: { w: ori.w, d: ori.d, h: ori.h },
          color: colors[idx % colors.length],
        }
        break outer
      }
    }
    if (!placedThis) {
      return null // cannot fit
    }
    placed.push(placedThis)
  }

  return placed
}

// Beam-search based 3D compaction in an unbounded virtual space to minimize overall bounding volume.
// Returns a dense cluster (placed items) and its usedWidth/Depth/Height.
function planBeamCompact3D(products: Product[]): { placed: PlacedItem[], usedWidth: number, usedDepth: number, usedHeight: number } | null {
  type State = { placed: PlacedItem[], usedW: number, usedD: number, usedH: number, score: number }
  const huge: Box = { id: 'HUGE', widthCm: 10000, depthCm: 10000, heightCm: 10000 }
  const items = [...products]
  const orderings: Product[][] = []
  // Base orderings
  orderings.push([...items].sort((a, b) => (b.widthCm*b.depthCm*b.heightCm) - (a.widthCm*a.depthCm*a.heightCm)))
  orderings.push([...items].sort((a, b) => (b.widthCm*b.depthCm) - (a.widthCm*a.depthCm)))
  // A few shuffles
  for (let i = 0; i < 4; i++) orderings.push(shuffle(items))

  let best: { placed: PlacedItem[], usedWidth: number, usedDepth: number, usedHeight: number, score: number } | null = null

  const COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f']

  for (const sequence of orderings) {
    let beam: State[] = [{ placed: [], usedW: 0, usedD: 0, usedH: 0, score: 0 }]
    const BEAM = 12
    const BRANCH_PER_STATE = 6
    for (let idx = 0; idx < sequence.length; idx++) {
      const prod = sequence[idx]
      const nextStates: State[] = []
      for (const st of beam) {
        const anchors = nextPlacementAnchors(st.placed, huge).slice(0, 16)
        const allOris = orientationsOf(prod)
        const minH = Math.min(...allOris.map(o => o.h))
        const flatOris = allOris.filter(o => o.h === minH)

        let produced = 0
        const tryOris = (oris: Orientation[], extraPenaltyPerOri: (o: Orientation) => number) => {
          for (const anchor of anchors) {
            for (const ori of oris) {
              const size = { w: ori.w, d: ori.d, h: ori.h }
              const compacted = compactPosition({ x: anchor.x, y: anchor.y, z: anchor.z }, size, huge, st.placed)
              if (!canPlaceAt(compacted.x, compacted.y, compacted.z, size, huge, st.placed)) continue
              if (!hasFullSupport(compacted.x, compacted.z, size.w, size.d, compacted.y, st.placed)) continue
              const placedItem: PlacedItem = {
                id: generateId(),
                productId: prod.id,
                x: compacted.x, y: compacted.y, z: compacted.z,
                rotation: ori.rot,
                size: { w: size.w, d: size.d, h: size.h },
                color: COLORS[idx % COLORS.length]
              }
              const usedW = Math.max(st.usedW, placedItem.x + placedItem.size.w)
              const usedD = Math.max(st.usedD, placedItem.z + placedItem.size.d)
              const usedH = Math.max(st.usedH, placedItem.y + placedItem.size.h)
              const volumeScore = usedW * usedD * Math.max(usedH, 1)
              const footprintScore = usedW * usedD
              const yPenalty = placedItem.y * 0.5 // discourage stacking when floor has space
              const oriPenalty = extraPenaltyPerOri(ori)
              const score = footprintScore * 1 + usedH * 0.05 + volumeScore * 0.0000001 + yPenalty + oriPenalty
              nextStates.push({ placed: [...st.placed, placedItem], usedW, usedD, usedH, score })
              produced++
              if (produced >= BRANCH_PER_STATE * BEAM) return
            }
          }
        }
        // 1) Strict flat-first
        tryOris(flatOris, () => 0)
        // 2) If no flat placements produced for this state, allow non-flat as fallback
        if (produced === 0) {
          const nonFlat = allOris.filter(o => o.h !== minH)
          tryOris(nonFlat, (o) => (o.h - minH) * 0.5)
        }
      }
      if (nextStates.length === 0) { beam = []; break }
      // Keep top states (lower score is better)
      nextStates.sort((a, b) => a.score - b.score)
      // Deduplicate by coarse bounding box
      const uniq: State[] = []
      const seen = new Set<string>()
      for (const s of nextStates) {
        const key = `${Math.round(s.usedW)}|${Math.round(s.usedD)}|${Math.round(s.usedH)}`
        if (seen.has(key)) continue
        seen.add(key)
        uniq.push(s)
        if (uniq.length >= BEAM * BRANCH_PER_STATE) break
      }
      beam = uniq.slice(0, BEAM)
    }
    if (beam.length > 0) {
      beam.sort((a, b) => (a.usedW*a.usedD) - (b.usedW*b.usedD) || a.usedH - b.usedH)
      const pick = beam[0]
      const result = { placed: pick.placed, usedWidth: pick.usedW, usedDepth: pick.usedD, usedHeight: pick.usedH, score: pick.score }
      if (!best || result.usedWidth * result.usedDepth * Math.max(result.usedHeight,1) < best.usedWidth * best.usedDepth * Math.max(best.usedHeight,1)) {
        best = result
      }
    }
  }

  if (best) return { placed: best.placed, usedWidth: best.usedWidth, usedDepth: best.usedDepth, usedHeight: best.usedHeight }
  return null
}

// Layer-first packing with multiple shelves per layer.
// Goal: fill the floor (y=0) as much as possible before stacking to higher layers.
function packShelfLayered(products: Product[], box: Box): PlacedItem[] | null {
  type Shelf = { zStart: number, depth: number, xCursor: number }

  let remaining: Product[] = [...products]
  const placed: PlacedItem[] = []
  const colors = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f']
  let colorIdx = 0
  let currentY = 0

  while (remaining.length > 0) {
    if (currentY >= box.heightCm) return null

    const shelves: Shelf[] = []
    let usedDepth = 0
    let layerHeight = 0
    const placedInLayer = new Set<string>()

    let progress = true
    while (progress) {
      progress = false

      // Sort remaining by decreasing base area, then by increasing height to maximize floor coverage
      const order = [...remaining].filter(p => !placedInLayer.has(p.id)).sort((a, b) => {
        const aArea = Math.max(a.widthCm * a.depthCm, 0)
        const bArea = Math.max(b.widthCm * b.depthCm, 0)
        if (aArea !== bArea) return bArea - aArea
        return Math.min(a.heightCm, b.heightCm) - Math.min(b.heightCm, a.heightCm)
      })

      for (const prod of order) {
        if (placedInLayer.has(prod.id)) continue

        const oris = orientationsOf(prod).sort((a, b) => {
          // prefer lower height first, then larger footprint
          if (a.h !== b.h) return a.h - b.h
          const aArea = a.w * a.d
          const bArea = b.w * b.d
          return bArea - aArea
        })

        let placedNow = false

        // 1) Try to fit into existing shelves with Best-Fit (maximize used width)
        for (const shelf of shelves) {
          const remainingWidth = box.widthCm - shelf.xCursor
          let bestOri: Orientation | null = null
          for (const ori of oris) {
            if (currentY + ori.h > box.heightCm) continue
            if (ori.d !== shelf.depth) continue
            if (ori.w > remainingWidth) continue
            if (!hasFullSupport(shelf.xCursor, shelf.zStart, ori.w, ori.d, currentY, placed)) continue
            if (!bestOri || ori.w > bestOri.w) bestOri = ori
          }
          if (bestOri) {
            placed.push({
              id: generateId(),
              productId: prod.id,
              x: shelf.xCursor,
              y: currentY,
              z: shelf.zStart,
              rotation: [0, 0, 0],
              size: { w: bestOri.w, d: shelf.depth, h: bestOri.h },
              color: colors[colorIdx++ % colors.length]
            })
            shelf.xCursor += bestOri.w
            layerHeight = Math.max(layerHeight, bestOri.h)
            placedInLayer.add(prod.id)
            placedNow = true
            break
          }
        }
        if (placedNow) { progress = true; continue }

        // 2) Start a new shelf at the next available Z if possible (avoid gaps along Z by growing forward)
        const nextZ = usedDepth
        for (const ori of oris) {
          if (currentY + ori.h > box.heightCm) continue
          if (ori.w > box.widthCm) continue
          if (nextZ + ori.d > box.depthCm) continue
          if (!hasFullSupport(0, nextZ, ori.w, ori.d, currentY, placed)) continue
          shelves.push({ zStart: nextZ, depth: ori.d, xCursor: ori.w })
          usedDepth += ori.d
          placed.push({
            id: generateId(),
            productId: prod.id,
            x: 0,
            y: currentY,
            z: nextZ,
            rotation: [0, 0, 0],
            size: { w: ori.w, d: ori.d, h: ori.h },
            color: colors[colorIdx++ % colors.length]
          })
          layerHeight = Math.max(layerHeight, ori.h)
          placedInLayer.add(prod.id)
          placedNow = true
          break
        }

        if (placedNow) { progress = true; continue }
      }
    }

    if (placedInLayer.size === 0) {
      // no placement possible in this layer ⇒ stop
      return null
    }

    // advance to next layer
    currentY += layerHeight
    remaining = remaining.filter(p => !placedInLayer.has(p.id))
  }

  return placed
}

// Deterministic Shelf-based 3D packing (NFDH-style):
// - Fills floor row-by-row (shelves along X), shelves advance along Z, then layers advance along Y
// - Only flat orientations per layer for stability
function packNFDH3D(products: Product[], box: Box): PlacedItem[] | null {
  let remaining = [...products]
  const placed: PlacedItem[] = []
  const colors = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f']
  let colorIdx = 0

  let currentY = 0
  while (remaining.length > 0) {
    if (currentY >= box.heightCm) return null
    let zStart = 0
    let layerHeight = 0

    // Re-sort at the start of each layer for determinism
    remaining = remaining.sort((a, b) => {
      const aArea = a.widthCm * a.depthCm
      const bArea = b.widthCm * b.depthCm
      if (aArea !== bArea) return bArea - aArea
      return a.heightCm - b.heightCm
    })

    let progressLayer = false
    while (zStart < box.depthCm && remaining.length > 0) {
      let xCursor = 0
      let shelfDepth = 0
      let shelfHeight = 0
      let placedInShelf = false

      // First item sets shelf depth and shelf height
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i]
        const all = orientationsOf(p)
        const minH = Math.min(...all.map(o => o.h))
        const flat = all.filter(o => o.h === minH)
        // choose orientation with largest footprint that fits width and remaining depth
        const candidate = flat
          .filter(o => o.w <= box.widthCm && o.d <= (box.depthCm - zStart) && currentY + o.h <= box.heightCm)
          .sort((a, b) => (b.w * b.d) - (a.w * a.d))[0]
        if (!candidate) continue
        // support check for this layer
        if (!hasFullSupport(0, zStart, candidate.w, candidate.d, currentY, placed)) continue
        shelfDepth = candidate.d
        shelfHeight = candidate.h
        layerHeight = Math.max(layerHeight, shelfHeight)
        // place first in shelf at x=0
        placed.push({
          id: generateId(), productId: p.id,
          x: 0, y: currentY, z: zStart,
          rotation: [0, 0, 0], size: { w: candidate.w, d: candidate.d, h: candidate.h },
          color: colors[colorIdx++ % colors.length]
        })
        xCursor = candidate.w
        remaining.splice(i, 1)
        placedInShelf = true
        progressLayer = true
        break
      }

      if (!placedInShelf) break // cannot start another shelf in this layer

      // Fill the shelf with other items of depth <= shelfDepth
      let progressShelf = true
      while (progressShelf) {
        progressShelf = false
        for (let i = 0; i < remaining.length; i++) {
          const p = remaining[i]
          const all = orientationsOf(p)
          const minH = Math.min(...all.map(o => o.h))
          const flat = all.filter(o => o.h === minH)
          const cand = flat
            .filter(o => o.h <= shelfHeight && o.d <= shelfDepth && o.w <= (box.widthCm - xCursor) && currentY + o.h <= box.heightCm)
            .sort((a, b) => b.w - a.w)[0]
          if (!cand) continue
          if (!hasFullSupport(xCursor, zStart, cand.w, cand.d, currentY, placed)) continue
          placed.push({
            id: generateId(), productId: p.id,
            x: xCursor, y: currentY, z: zStart,
            rotation: [0, 0, 0], size: { w: cand.w, d: cand.d, h: cand.h },
            color: colors[colorIdx++ % colors.length]
          })
          xCursor += cand.w
          remaining.splice(i, 1)
          progressShelf = true
          placedInShelf = true
          break
        }
      }

      // advance Z to next shelf start
      zStart += shelfDepth
      if (!placedInShelf) break
    }

    if (!progressLayer) return null
    currentY += layerHeight
  }

  return placed
}

// Max-rectangles based layer packing: fills the floor area with minimal gaps before stacking
type PackingConfig = {
  orientationOrder: 'minHeightFirst' | 'maxFootprintFirst' | 'widthPriority' | 'depthPriority'
  productOrder: 'areaDesc' | 'edgeDesc' | 'shuffle'
  // When true, only lowest-height orientations are allowed on a layer (stable/floor-first). When false, allow any orientation to minimize volume.
  flatOnly?: boolean
}

function packMaxRectsLayered(products: Product[], box: Box, cfg: PackingConfig = { orientationOrder: 'minHeightFirst', productOrder: 'areaDesc', flatOnly: true }): PlacedItem[] | null {
  type Rect = { x: number, z: number, w: number, d: number }

  const remaining: Product[] = [...products]
  const placed: PlacedItem[] = []
  const colors = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f']
  let colorIdx = 0
  let currentY = 0

  function pruneRects(rects: Rect[]): Rect[] {
    // remove zero/negative and fully contained rects; dedupe
    const filtered = rects.filter(r => r.w > 0 && r.d > 0)
    const out: Rect[] = []
    for (let i = 0; i < filtered.length; i++) {
      const a = filtered[i]
      let contained = false
      for (let j = 0; j < filtered.length; j++) {
        if (i === j) continue
        const b = filtered[j]
        if (a.x >= b.x && a.z >= b.z && a.x + a.w <= b.x + b.w && a.z + a.d <= b.z + b.d) {
          contained = true
          break
        }
      }
      if (!contained && !out.some(o => o.x === a.x && o.z === a.z && o.w === a.w && o.d === a.d)) out.push(a)
    }
    return out
  }

  function mergeRects(rects: Rect[]): Rect[] {
    let changed = true
    let arr = [...rects]
    while (changed) {
      changed = false
      outer: for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j]
          // horizontal merge (same z & d, adjacent in x)
          if (a.z === b.z && a.d === b.d) {
            if (a.x + a.w === b.x) {
              arr.splice(j, 1)
              arr.splice(i, 1, { x: a.x, z: a.z, w: a.w + b.w, d: a.d })
              changed = true
              break outer
            }
            if (b.x + b.w === a.x) {
              arr.splice(j, 1)
              arr.splice(i, 1, { x: b.x, z: a.z, w: a.w + b.w, d: a.d })
              changed = true
              break outer
            }
          }
          // vertical merge (same x & w, adjacent in z)
          if (a.x === b.x && a.w === b.w) {
            if (a.z + a.d === b.z) {
              arr.splice(j, 1)
              arr.splice(i, 1, { x: a.x, z: a.z, w: a.w, d: a.d + b.d })
              changed = true
              break outer
            }
            if (b.z + b.d === a.z) {
              arr.splice(j, 1)
              arr.splice(i, 1, { x: a.x, z: b.z, w: a.w, d: a.d + b.d })
              changed = true
              break outer
            }
          }
        }
      }
    }
    return arr
  }

  function supportSurfaceRects(layerY: number): Rect[] {
    // Project top faces of items whose top equals layerY onto XZ plane
    const faces: Rect[] = placed
      .filter(it => it.y + it.size.h === layerY)
      .map(it => ({ x: it.x, z: it.z, w: it.size.w, d: it.size.d }))
    if (faces.length === 0) return []
    return mergeRects(pruneRects(faces))
  }

  while (remaining.length > 0) {
    if (currentY >= box.heightCm) return null
    let freeRects: Rect[]
    if (currentY === 0) {
      freeRects = [{ x: 0, z: 0, w: box.widthCm, d: box.depthCm }]
    } else {
      const surfaces = supportSurfaceRects(currentY)
      freeRects = surfaces.length > 0 ? surfaces : [{ x: 0, z: 0, w: box.widthCm, d: box.depthCm }]
    }
    let layerHeight = 0
    const placedInLayer = new Set<string>()

    let order: Product[]
    if (cfg.productOrder === 'shuffle') {
      order = shuffle([...remaining])
    } else if (cfg.productOrder === 'edgeDesc') {
      order = [...remaining].sort((a, b) => {
        const aEdge = Math.max(a.widthCm, a.depthCm)
        const bEdge = Math.max(b.widthCm, b.depthCm)
        if (aEdge !== bEdge) return bEdge - aEdge
        return (a.widthCm * a.depthCm) - (b.widthCm * b.depthCm)
      })
    } else {
      // areaDesc
      order = [...remaining].sort((a, b) => {
        const aArea = a.widthCm * a.depthCm
        const bArea = b.widthCm * b.depthCm
        if (aArea !== bArea) return bArea - aArea
        return a.heightCm - b.heightCm
      })
    }

    let progress = true
    while (progress) {
      progress = false

      // Pass A: Rect-first sweep on current support surface. Iterate free rectangles (near-origin first)
      // and place the largest-footprint product that fits with flat orientation.
      outerRect: for (const r of [...freeRects].sort((a, b) => (a.z - b.z) || (a.x - b.x))) {
        let bestPick: null | { prodIdx: number, ori: Orientation, waste: number, area: number } = null
        for (let pi = 0; pi < remaining.length; pi++) {
          const prod = remaining[pi]
          if (placedInLayer.has(prod.id)) continue
          const all = orientationsOf(prod)
          const minH = Math.min(...all.map(o => o.h))
          const flat = all.filter(o => o.h === minH)
          for (const ori of flat) {
            if (currentY + ori.h > box.heightCm) continue
            if (ori.w <= r.w && ori.d <= r.d && hasFullSupport(r.x, r.z, ori.w, ori.d, currentY, placed)) {
              const area = ori.w * ori.d
              const waste = r.w * r.d - area
              if (!bestPick || area > bestPick.area || (area === bestPick.area && waste < bestPick.waste)) {
                bestPick = { prodIdx: pi, ori, waste, area }
              }
            }
          }
        }
        if (bestPick) {
          const prod = remaining[bestPick.prodIdx]
          placed.push({
            id: generateId(),
            productId: prod.id,
            x: r.x,
            y: currentY,
            z: r.z,
            rotation: [0, 0, 0],
            size: { w: bestPick.ori.w, d: bestPick.ori.d, h: bestPick.ori.h },
            color: colors[colorIdx++ % colors.length]
          })
          layerHeight = Math.max(layerHeight, bestPick.ori.h)
          placedInLayer.add(prod.id)
          // split used rect
          const idx = freeRects.findIndex(fr => fr.x === r.x && fr.z === r.z && fr.w === r.w && fr.d === r.d)
          if (idx >= 0) {
            const used = freeRects[idx]
            const right = { x: used.x + bestPick.ori.w, z: used.z, w: used.w - bestPick.ori.w, d: bestPick.ori.d }
            const bottom = { x: used.x, z: used.z + bestPick.ori.d, w: used.w, d: used.d - bestPick.ori.d }
            freeRects.splice(idx, 1)
            freeRects.push(right)
            freeRects.push(bottom)
            freeRects = pruneRects(freeRects)
            freeRects = mergeRects(freeRects)
          }
          progress = true
          break outerRect
        }
      }

      if (progress) continue

      // Pass B: Product-first sweep (existing heuristic)
      for (const prod of order) {
        if (placedInLayer.has(prod.id)) continue
        let best: null | { rectIdx: number, pos: { x: number, z: number }, ori: Orientation, waste: number, bias: number, contact: number, zOrder: number, xOrder: number } = null
        const baseOris = orientationsOf(prod).sort((a, b) => {
          // Horizontal-first: penalize tall orientations, prefer low height
          if (a.h !== b.h) return a.h - b.h
          // additional bias: if item is slender (one edge much bigger), prefer laying the longest edge along X or Z
          const aLongest = Math.max(a.w, a.d)
          const bLongest = Math.max(b.w, b.d)
          if (aLongest !== bLongest) return bLongest - aLongest
          if (cfg.orientationOrder === 'maxFootprintFirst') {
            const aa = a.w * a.d, bb = b.w * b.d
            if (aa !== bb) return bb - aa
            return 0
          }
          if (cfg.orientationOrder === 'widthPriority') {
            if (a.w !== b.w) return b.w - a.w
            return b.d - a.d
          }
          if (cfg.orientationOrder === 'depthPriority') {
            if (a.d !== b.d) return b.d - a.d
            return b.w - a.w
          }
          // default: area desc
          return (b.w * b.d) - (a.w * a.d)
        })
        const minH = Math.min(...baseOris.map(o => o.h))
        const flatOris = baseOris.filter(o => o.h === minH)
        const flatFitsSomewhere = freeRects.some(r => flatOris.some(o => o.w <= r.w && o.d <= r.d))
        const oris = (cfg.flatOnly ?? true) ? (flatFitsSomewhere ? flatOris : []) : baseOris
        for (let ri = 0; ri < freeRects.length; ri++) {
          const r = freeRects[ri]
          for (const ori of oris) {
            if (currentY + ori.h > box.heightCm) continue
            if (ori.w <= r.w && ori.d <= r.d) {
              if (!hasFullSupport(r.x, r.z, ori.w, ori.d, currentY, placed)) continue
              const waste = r.w * r.d - ori.w * ori.d
              const bias = r.x + r.z // prefer near-origin to keep cluster compact
              // priority: lowest available layer (currentY fixed), then lowest z then lowest x
              // de-prioritize contact score entirely to avoid chasing adjacency if floor space exists
              const contact = 0
              const zOrder = r.z
              const xOrder = r.x
              if (
                !best ||
                zOrder < best.zOrder ||
                (zOrder === best.zOrder && (xOrder < best.xOrder ||
                  (xOrder === best.xOrder && (waste < best.waste ||
                    (waste === best.waste && (contact > best.contact || (contact === best.contact && bias < best.bias)))))))
              ) {
                best = { rectIdx: ri, pos: { x: r.x, z: r.z }, ori, waste, bias, contact, zOrder, xOrder }
              }
            }
          }
        }
        if (best) {
          // place
          placed.push({
            id: generateId(),
            productId: prod.id,
            x: best.pos.x,
            y: currentY,
            z: best.pos.z,
            rotation: [0, 0, 0],
            size: { w: best.ori.w, d: best.ori.d, h: best.ori.h },
            color: colors[colorIdx++ % colors.length]
          })
          layerHeight = Math.max(layerHeight, best.ori.h)
          placedInLayer.add(prod.id)
          // split rect
          const used = freeRects[best.rectIdx]
          const right: Rect = { x: used.x + best.ori.w, z: used.z, w: used.w - best.ori.w, d: best.ori.d }
          const bottom: Rect = { x: used.x, z: used.z + best.ori.d, w: used.w, d: used.d - best.ori.d }
          // replace used rect with bottom, and also push right (order doesn't matter)
          freeRects.splice(best.rectIdx, 1)
          freeRects.push(right)
          freeRects.push(bottom)
          freeRects = pruneRects(freeRects)
          freeRects = mergeRects(freeRects)
          progress = true
        }
      }
      // fallback pass: if nothing placed this sweep but tabanda kalan dikdörtgenlere sığabilecek ürün varsa, küçük alana küçük ürün yerleştir
      if (!progress) {
        let placedFallback = false
        // free rects in Z then X order
        const rectsOrdered = [...freeRects].sort((a, b) => (a.z - b.z) || (a.x - b.x))
        // products from smallest footprint to largest
        const smallFirst = [...remaining].filter(p => !placedInLayer.has(p.id)).sort((a, b) => (a.widthCm * a.depthCm) - (b.widthCm * b.depthCm))
        outerFallback: for (const r of rectsOrdered) {
          for (const prod of smallFirst) {
            const all = orientationsOf(prod)
            if (cfg.flatOnly ?? true) {
              const minH2 = Math.min(...all.map(o => o.h))
              const flat2 = all.filter(o => o.h === minH2)
              var oris = flat2.some(o => o.w <= r.w && o.d <= r.d) ? flat2 : []
            } else {
              var oris = all
            }
            for (const ori of oris) {
              if (currentY + ori.h > box.heightCm) continue
              if (ori.w <= r.w && ori.d <= r.d) {
                // floor layer support check
                if (!hasFullSupport(r.x, r.z, ori.w, ori.d, currentY, placed)) continue
                placed.push({
                  id: generateId(),
                  productId: prod.id,
                  x: r.x,
                  y: currentY,
                  z: r.z,
                  rotation: [0, 0, 0],
                  size: { w: ori.w, d: ori.d, h: ori.h },
                  color: colors[colorIdx++ % colors.length]
                })
                layerHeight = Math.max(layerHeight, ori.h)
                placedInLayer.add(prod.id)
                // split used rect
                const idx = freeRects.findIndex(fr => fr.x === r.x && fr.z === r.z && fr.w === r.w && fr.d === r.d)
                if (idx >= 0) {
                  const used = freeRects[idx]
                  const right = { x: used.x + ori.w, z: used.z, w: used.w - ori.w, d: ori.d }
                  const bottom = { x: used.x, z: used.z + ori.d, w: used.w, d: used.d - ori.d }
                  freeRects.splice(idx, 1)
                  freeRects.push(right)
                  freeRects.push(bottom)
                  freeRects = pruneRects(freeRects)
                  freeRects = mergeRects(freeRects)
                }
                placedFallback = true
                break outerFallback
              }
            }
          }
        }
        if (placedFallback) {
          progress = true
        }
      }
      // strict layer rule: as long as there exists ANY remaining product that fits ANY free rect on this layer, do not advance layer
      if (!progress) {
        let bestFit: null | { rIndex: number, pos: { x: number, z: number }, ori: Orientation, prodIdx: number, waste: number } = null
        for (let ri = 0; ri < freeRects.length; ri++) {
          const r = freeRects[ri]
          for (let pi = 0; pi < remaining.length; pi++) {
            const prod = remaining[pi]
            if (placedInLayer.has(prod.id)) continue
            const all = orientationsOf(prod)
            let use: Orientation[]
            if (cfg.flatOnly ?? true) {
              const minH = Math.min(...all.map(o => o.h))
              const flat = all.filter(o => o.h === minH)
              use = flat.some(o => o.w <= r.w && o.d <= r.d) ? flat : []
            } else {
              use = all
            }
            for (const ori of use) {
              if (currentY + ori.h > box.heightCm) continue
              if (ori.w <= r.w && ori.d <= r.d && hasFullSupport(r.x, r.z, ori.w, ori.d, currentY, placed)) {
                const waste = r.w * r.d - ori.w * ori.d
                if (!bestFit || waste < bestFit.waste) {
                  bestFit = { rIndex: ri, pos: { x: r.x, z: r.z }, ori, prodIdx: pi, waste }
                }
              }
            }
          }
        }
        if (bestFit) {
          const prod = remaining[bestFit.prodIdx]
          placed.push({
            id: generateId(),
            productId: prod.id,
            x: bestFit.pos.x,
            y: currentY,
            z: bestFit.pos.z,
            rotation: [0, 0, 0],
            size: { w: bestFit.ori.w, d: bestFit.ori.d, h: bestFit.ori.h },
            color: colors[colorIdx++ % colors.length]
          })
          layerHeight = Math.max(layerHeight, bestFit.ori.h)
          placedInLayer.add(prod.id)
          const used = freeRects[bestFit.rIndex]
          const right = { x: used.x + bestFit.ori.w, z: used.z, w: used.w - bestFit.ori.w, d: bestFit.ori.d }
          const bottom = { x: used.x, z: used.z + bestFit.ori.d, w: used.w, d: used.d - bestFit.ori.d }
          freeRects.splice(bestFit.rIndex, 1)
          freeRects.push(right)
          freeRects.push(bottom)
          freeRects = pruneRects(freeRects)
          freeRects = mergeRects(freeRects)
          progress = true
        }
      }
    }

    if (placedInLayer.size === 0) return null
    // advance to next layer
    currentY += layerHeight
    // remove placed products from remaining
    for (const id of placedInLayer) {
      const idx = remaining.findIndex(p => p.id === id)
      if (idx >= 0) remaining.splice(idx, 1)
    }
  }

  return placed
}

function planFlexiblePacking(products: Product[]): { placed: PlacedItem[], usedWidth: number, usedDepth: number, usedHeight: number } | null {
  // We search multiple packing strategies and footprint budgets.
  // Goal: minimize bounding VOLUME first (cimri), then prefer lower height.
  const virtualTall: Box = { id: 'virtual', widthCm: 1000, depthCm: 1000, heightCm: 1000 }
  const baseConfigs: PackingConfig[] = [
    { orientationOrder: 'minHeightFirst', productOrder: 'areaDesc' },
    { orientationOrder: 'maxFootprintFirst', productOrder: 'areaDesc' },
    { orientationOrder: 'widthPriority', productOrder: 'edgeDesc' },
    { orientationOrder: 'depthPriority', productOrder: 'edgeDesc' },
  ]

  type Plan = { placed: PlacedItem[], usedWidth: number, usedDepth: number, usedHeight: number, score: number }
  let best: Plan | null = null

  const consider = (placed: PlacedItem[]) => {
    const usedWidth = placed.reduce((m, p) => Math.max(m, p.x + p.size.w), 0)
    const usedDepth = placed.reduce((m, p) => Math.max(m, p.z + p.size.d), 0)
    const usedHeight = placed.reduce((m, p) => Math.max(m, p.y + p.size.h), 0)
    const vol = usedWidth * usedDepth * Math.max(usedHeight, 1)
    const area = usedWidth * usedDepth
    // Footprint-first greediness: minimize XY area aggressively to encourage stacking,
    // then prefer lower height slightly; keep volume as a tiny tie-breaker.
    const score = area * 1 + usedHeight * 0.01 + vol * 0.0000001
    const plan: Plan = { placed, usedWidth, usedDepth, usedHeight, score }
    if (!best || plan.score < best.score) best = plan
  }

  // 1) Unconstrained tall virtual box: find dense variants
  for (const cfg of baseConfigs) {
    const placed = packMaxRectsLayered(products, virtualTall, { ...cfg, flatOnly: false })
    if (placed) consider(placed)
  }
  for (let i = 0; i < 24; i++) {
    const placed = packMaxRectsLayered(products, virtualTall, { orientationOrder: 'minHeightFirst', productOrder: 'shuffle', flatOnly: false })
    if (placed) consider(placed)
  }

  // 2) Footprint budget search: limit width/depth to encourage stacking if that reduces overall volume.
  // Estimate base square from minimal-orientation areas
  const minAreas = products.map(p => Math.min(...orientationsOf(p).map(o => o.w * o.d)))
  const sumMinArea = minAreas.reduce((a, b) => a + b, 0)
  const baseSide = Math.sqrt(Math.max(1, sumMinArea))
  // Try tighter footprint budgets first to encourage stacking and smaller boxes
  const scales = [0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.0]
  const ratios = [1.0, 1.1, 1.3, 1.5, 1.8, 2.2, 2.8]

  const tryBudget = (W: number, D: number) => {
    const vb: Box = { id: 'virtual-budget', widthCm: Math.ceil(W), depthCm: Math.ceil(D), heightCm: 1000 }
    for (const cfg of baseConfigs) {
      const placed = packMaxRectsLayered(products, vb, { ...cfg, flatOnly: false })
      if (placed) consider(placed)
    }
    // more shuffles for this budget to explore denser packings
    for (let i = 0; i < 20; i++) {
      const placed = packMaxRectsLayered(products, vb, { orientationOrder: 'maxFootprintFirst', productOrder: 'shuffle', flatOnly: false })
      if (placed) consider(placed)
    }
  }

  for (const s of scales) {
    for (const r of ratios) {
      const w1 = baseSide * s * Math.sqrt(r)
      const d1 = baseSide * s / Math.sqrt(r)
      tryBudget(w1, d1)
      tryBudget(d1, w1)
    }
  }

  if (best) {
    const { placed, usedWidth, usedDepth, usedHeight } = best as Plan
    return { placed, usedWidth, usedDepth, usedHeight }
  }
  return null
}

function chooseSmallestFittingBox(boxes: Box[], products: Product[]): { box: Box, placed: PlacedItem[] } | null {
  const sorted = [...boxes].sort((a, b) => volume(a.widthCm, a.depthCm, a.heightCm) - volume(b.widthCm, b.depthCm, b.heightCm))
  // First try flexible plan to derive minimal footprint, then match to smallest box
  // First try a beam-search compact 3D plan to get the absolute minimal cluster
  const beam = planBeamCompact3D(products)
  const flex = beam ?? planFlexiblePacking(products)
  if (flex) {
    const tryRepack = (box: Box): PlacedItem[] | null => {
      // Prefer deterministic shelf fill to maximize floor coverage in the real box
      const shelf = packNFDH3D(products, box)
      if (shelf) return shelf
      const configs: PackingConfig[] = [
        // Real box repack: enforce floor-first stability (flatOnly: true)
        { orientationOrder: 'minHeightFirst', productOrder: 'areaDesc', flatOnly: true },
        { orientationOrder: 'maxFootprintFirst', productOrder: 'edgeDesc', flatOnly: true },
        { orientationOrder: 'widthPriority', productOrder: 'edgeDesc', flatOnly: true },
        { orientationOrder: 'depthPriority', productOrder: 'edgeDesc', flatOnly: true },
      ]
      for (const cfg of configs) {
        const placed = packMaxRectsLayered(products, box, cfg)
        if (placed) return placed
      }
      // a few shuffles to explore alternatives
      for (let i = 0; i < 8; i++) {
        const placed = packMaxRectsLayered(products, box, { orientationOrder: 'minHeightFirst', productOrder: 'shuffle', flatOnly: true })
        if (placed) return placed
      }
      return null
    }

    const matching = sorted.find(b => (b.widthCm >= flex.usedWidth && b.depthCm >= flex.usedDepth && b.heightCm >= flex.usedHeight))
    if (matching) {
      // Repack for the actual chosen box to fill floor/edges instead of keeping a narrow virtual footprint
      const repacked = tryRepack(matching)
      return { box: matching, placed: repacked ?? flex.placed }
    }
    const swapped = sorted.find(b => (b.widthCm >= flex.usedDepth && b.depthCm >= flex.usedWidth && b.heightCm >= flex.usedHeight))
    if (swapped) {
      const repacked = tryRepack(swapped)
      if (repacked) return { box: swapped, placed: repacked }
      // Fallback: swap X<->Z of flexible layout to fit orientation
      const swappedPlaced = flex.placed.map(p => ({
        ...p,
        x: p.z,
        z: p.x,
        size: { w: p.size.d, d: p.size.w, h: p.size.h },
      }))
      return { box: swapped, placed: swappedPlaced }
    }
  }
  // If flexible plan couldn't produce any layout, try strict max-rects directly on real boxes (no greedy/shelf fallback)
  for (const box of sorted) {
    // Try deterministic shelf-based fallback for robustness
    const shelfPlaced = packNFDH3D(products, box)
    if (shelfPlaced) return { box, placed: shelfPlaced }
    // As a last attempt, try a couple of max-rect configs
    const placed1 = packMaxRectsLayered(products, box, { orientationOrder: 'minHeightFirst', productOrder: 'areaDesc', flatOnly: true })
    if (placed1) return { box, placed: placed1 }
    const placed2 = packMaxRectsLayered(products, box, { orientationOrder: 'maxFootprintFirst', productOrder: 'edgeDesc', flatOnly: true })
    if (placed2) return { box, placed: placed2 }
  }
  return null
}

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
    const selectedProducts = s.productCatalog.filter(p => s.selectedProductIds.includes(p.id))
    if (selectedProducts.length === 0) return
    const result = chooseSmallestFittingBox(s.boxCatalog, selectedProducts)
    if (!result) {
      set({ selectedBoxId: null, placedItems: [], suggestedPlacements: [], suggestionIndex: 0, statusMessage: 'Seçilen ürünler mevcut kolilere sığmıyor. Daha büyük bir koli ekleyin veya seçim sayısını azaltın.' })
      return
    }
    set({ selectedBoxId: result.box.id, placedItems: [], suggestedPlacements: result.placed, suggestionIndex: 0, statusMessage: null })
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


