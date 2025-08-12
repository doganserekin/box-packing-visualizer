import React, { useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../util/store'

type Props = { unitsPerCm: number }

function TransparentBox({ w, d, h }: { w: number, d: number, h: number }) {
  const geom = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geom), [geom])
  return (
    <group>
      <mesh geometry={geom} position={[w/2, h/2, d/2]} renderOrder={1}> 
        <meshBasicMaterial color="#5b8cff" transparent opacity={0.06} depthWrite={false} depthTest={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <lineSegments geometry={edges} position={[w/2, h/2, d/2]} renderOrder={2}>
        <lineBasicMaterial color="#5b8cff" linewidth={1} depthTest={false} />
      </lineSegments>
    </group>
  )
}

function ItemBlock({ x, y, z, w, d, h, color, rotation, pulse = 0 }: { x: number, y: number, z: number, w: number, d: number, h: number, color: string, rotation: [number, number, number], pulse?: number }) {
  const ref = React.useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    if (pulse > 0) {
      const t = clock.getElapsedTime()
      const s = 1 + 0.05 * Math.sin(t * 6.0)
      ref.current.scale.setScalar(s)
    } else {
      ref.current.scale.setScalar(1)
    }
  })
  return (
    <mesh ref={ref} position={[x + w/2, y + h/2, z + d/2]} rotation={rotation as any}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} emissive={pulse > 0 ? new THREE.Color(color) : undefined} emissiveIntensity={pulse > 0 ? 0.2 : 0} />
    </mesh>
  )
}

export function PackingScene({ unitsPerCm }: Props) {
  const { boxCatalog, selectedBoxId, placedItems, suggestedPlacements, suggestionIndex, confirmNextPlacement } = useStore()
  const box = boxCatalog.find(b => b.id === selectedBoxId)

  const ghost = suggestedPlacements[suggestionIndex]

  return (
    <>
      <Canvas
        camera={{ position: [80, 80, 80], fov: 45 }}
        dpr={[1, Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true }}
      >
        <color attach="background" args={[0x0b1021]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 100, 20]} intensity={0.8} />

        <Grid args={[200, 200]} sectionSize={10} sectionColor="#223" cellColor="#112" position={[0, -0.01, 0]} />

        <group scale={[unitsPerCm, unitsPerCm, unitsPerCm]} position={box ? [-box.widthCm/2, 0, -box.depthCm/2] : [0,0,0]}>
          {box && <TransparentBox w={box.widthCm} d={box.depthCm} h={box.heightCm} />}

          {box && placedItems.map(it => (
            it.x + it.size.w <= box.widthCm && it.z + it.size.d <= box.depthCm && it.y + it.size.h <= box.heightCm ? (
              <ItemBlock key={it.id} x={it.x} y={it.y} z={it.z} w={it.size.w} d={it.size.d} h={it.size.h} color={it.color} rotation={it.rotation} />
            ) : null
          ))}

          {box && ghost && ghost.x + ghost.size.w <= box.widthCm && ghost.z + ghost.size.d <= box.depthCm && ghost.y + ghost.size.h <= box.heightCm && (
            <ItemBlock x={ghost.x} y={ghost.y} z={ghost.z} w={ghost.size.w} d={ghost.size.d} h={ghost.size.h} color={ghost.color} rotation={ghost.rotation} pulse={1} />
          )}
        </group>

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}> 
          <GizmoViewport axisColors={["#ff6b6b", "#06d6a0", "#5b8cff"]} labelColor="#fff" />
        </GizmoHelper>
        <OrbitControls makeDefault target={[0, 0, 0]} enableDamping dampingFactor={0.08} />

        <HtmlControls />
      </Canvas>
      
      {/* Box dimensions display overlay */}
      {box && (
        <div className="floating-controls" style={{ top: 20, left: 20, pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(0,0,0,0.75)',
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid rgba(91, 140, 255, 0.3)',
            color: '#fff',
            fontSize: '14px',
            fontFamily: 'monospace'
          }}>
            <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#5b8cff' }}>Seçili Koli</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '8px 16px', fontSize: '13px' }}>
              <span>Genişlik:</span>
              <span>{box.widthCm} cm</span>
              <span>Derinlik:</span>
              <span>{box.depthCm} cm</span>
              <span>Yükseklik:</span>
              <span>{box.heightCm} cm</span>
              <span>Hacim:</span>
              <span>{(box.widthCm * box.depthCm * box.heightCm).toLocaleString()} cm³</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function HtmlControls() {
  const { suggestedPlacements, suggestionIndex, confirmNextPlacement } = useStore()
  if (suggestedPlacements.length === 0 || suggestionIndex >= suggestedPlacements.length) return null
  return (
    <group />
  )
}


