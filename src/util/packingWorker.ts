// Worker code for heavy packing computations
// Remove import and add generateId function directly

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

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
  x: number
  y: number
  z: number
  rotation: [number, number, number]
  size: { w: number, d: number, h: number }
  color: string
}

type Orientation = { w: number, d: number, h: number, rot: [number, number, number] }

function volume(w: number, d: number, h: number) {
  return w * d * h
}

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

function greedyPack(products: Product[], box: Box): PlacedItem[] | null {
  const placed: PlacedItem[] = []
  const colors = [
    '#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#8e7dbe', '#00c2ff', '#ffa600', '#2a9d8f'
  ]
  const items = [...products].sort((a, b) => volume(b.widthCm, b.depthCm, b.heightCm) - volume(a.widthCm, a.depthCm, a.heightCm))

  for (let idx = 0; idx < items.length; idx++) {
    const prod = items[idx]
    let placedThis: PlacedItem | null = null
    
    // Try to place on floor first (y=0), then on top of other items
    const tryPlace = (y: number) => {
      for (let x = 0; x <= box.widthCm; x += 2) {
        for (let z = 0; z <= box.depthCm; z += 2) {
          const orientations = orientationsOf(prod)
          for (const ori of orientations) {
            if (canPlaceAt(x, y, z, { w: ori.w, d: ori.d, h: ori.h }, box, placed) &&
                hasFullSupport(x, z, ori.w, ori.d, y, placed)) {
              return {
                id: generateId(),
                productId: prod.id,
                x, y, z,
                rotation: ori.rot,
                size: { w: ori.w, d: ori.d, h: ori.h },
                color: colors[idx % colors.length],
              }
            }
          }
        }
      }
      return null
    }

    // Try floor first
    placedThis = tryPlace(0)
    if (!placedThis) {
      // Try on top of other items
      for (const item of placed) {
        const y = item.y + item.size.h
        placedThis = tryPlace(y)
        if (placedThis) break
      }
    }

    if (!placedThis) {
      return null // cannot fit
    }
    placed.push(placedThis)
  }

  return placed
}

function chooseSmallestFittingBox(boxes: Box[], products: Product[]): { box: Box, placed: PlacedItem[] } | null {
  console.log('[WORKER] Starting packing for', products.length, 'products');
  const sorted = [...boxes].sort((a, b) => volume(a.widthCm, a.depthCm, a.heightCm) - volume(b.widthCm, b.depthCm, b.heightCm))
  
  for (const box of sorted) {
    const placed = greedyPack(products, box)
    if (placed) {
      console.log('[WORKER] Found fitting box:', box);
      return { box, placed }
    }
  }
  
  return null
}

self.onmessage = (e: MessageEvent) => {
  console.log('[WORKER] Received message:', e.data);
  const { type, boxes, products } = e.data;
  if (type === 'pack') {
    console.log('[WORKER] Starting packing for', products.length, 'products');
    const result = chooseSmallestFittingBox(boxes, products);
    console.log('[WORKER] Packing result:', result);
    self.postMessage(result);
  }
};
