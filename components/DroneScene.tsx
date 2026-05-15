'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const CYAN = '#3DE0FF';
const PURPLE = '#7C5CFF';
const INK = '#e9eef8';

function Prop({
  position,
  color,
  reverse,
  speed = 22,
}: {
  position: [number, number, number];
  color: string;
  reverse?: boolean;
  speed?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += (reverse ? -1 : 1) * dt * speed;
  });
  return (
    <group ref={ref} position={position}>
      <mesh>
        <cylinderGeometry args={[0.08, 0.08, 0.08, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[1.3, 0.02, 0.08]} />
        <meshStandardMaterial color={INK} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[1.3, 0.02, 0.08]} />
        <meshStandardMaterial color={INK} transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

function Ring({
  radius,
  color,
  speed,
  tilt,
  thickness = 0.012,
}: {
  radius: number;
  color: string;
  speed: number;
  tilt: number;
  thickness?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2 + tilt, 0, 0]}>
      <torusGeometry args={[radius, thickness, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </mesh>
  );
}

function TickRing({ radius, color, tilt }: { radius: number; color: string; tilt: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.rotation.z += dt * 0.1;
  });
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, i) => (i / 24) * Math.PI * 2), []);
  return (
    <group ref={group} rotation={[Math.PI / 2 + tilt, 0, 0]}>
      {ticks.map((t, i) => (
        <mesh key={i} position={[Math.cos(t) * radius, Math.sin(t) * radius, 0]} rotation={[0, 0, t]}>
          <boxGeometry args={[0.05, 0.012, 0.012]} />
          <meshBasicMaterial color={color} transparent opacity={i % 4 === 0 ? 0.9 : 0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Particles() {
  const ref = useRef<THREE.Points>(null);
  const { positions, velocities } = useMemo(() => {
    const count = 260;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
      vel[i * 3 + 0] = (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    return { positions: pos, velocities: vel };
  }, []);

  useFrame((_, dt) => {
    if (!ref.current) return;
    const geom = ref.current.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 0] += velocities[i + 0] * dt;
      arr[i + 1] += velocities[i + 1] * dt;
      arr[i + 2] += velocities[i + 2] * dt;
      if (Math.abs(arr[i]) > 7) arr[i] *= -0.99;
      if (Math.abs(arr[i + 1]) > 4) arr[i + 1] *= -0.99;
    }
    pos.needsUpdate = true;
    ref.current.rotation.y += dt * 0.04;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.025} color={CYAN} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

function ScanBeam() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.getElapsedTime();
    ref.current.rotation.y = t * 0.4;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.05 + 0.04 * Math.sin(t * 2.0);
  });
  return (
    <mesh ref={ref} position={[0, -0.2, 0]} rotation={[Math.PI / 2.2, 0, 0]}>
      <coneGeometry args={[1.6, 2.6, 32, 1, true]} />
      <meshBasicMaterial color={CYAN} transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Drone() {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useFrame((state, dt) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    current.current.x += (target.current.x - current.current.x) * 4 * dt;
    current.current.y += (target.current.y - current.current.y) * 4 * dt;
    group.current.rotation.x = current.current.y * 0.25 + Math.sin(t * 0.6) * 0.04;
    group.current.rotation.z = Math.sin(t * 0.4) * 0.04;
    group.current.rotation.y =
      current.current.x * 0.4 + (hovered ? group.current.rotation.y : group.current.rotation.y + dt * 0.2);
    group.current.position.y = Math.sin(t) * 0.16;
  });

  return (
    <group
      ref={group}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerMove={(e) => {
        const rect = gl.domElement.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        target.current.x = nx;
        target.current.y = ny;
      }}
    >
      {/* Fuselage */}
      <mesh>
        <boxGeometry args={[1.6, 0.32, 0.5]} />
        <meshStandardMaterial color="#1a2236" metalness={0.4} roughness={0.55} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(1.62, 0.34, 0.52)]} />
        <lineBasicMaterial color={CYAN} transparent opacity={0.9} />
      </lineSegments>

      {/* Nose */}
      <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.22, 0.4, 16]} />
        <meshStandardMaterial color="#101725" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[1.12, 0, 0]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1.4} />
      </mesh>

      {/* Wings */}
      <mesh>
        <boxGeometry args={[0.6, 0.05, 3.4]} />
        <meshStandardMaterial color="#152031" metalness={0.3} roughness={0.6} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(0.62, 0.06, 3.42)]} />
        <lineBasicMaterial color={CYAN} transparent opacity={0.55} />
      </lineSegments>

      {/* Wing tip rotors */}
      <group position={[0, 0.12, 1.7]}>
        <mesh>
          <torusGeometry args={[0.32, 0.04, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.55} />
        </mesh>
        <Prop position={[0, 0.05, 0]} color={CYAN} />
      </group>
      <group position={[0, 0.12, -1.7]}>
        <mesh>
          <torusGeometry args={[0.32, 0.04, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.55} />
        </mesh>
        <Prop position={[0, 0.05, 0]} color={CYAN} reverse />
      </group>

      {/* Tail boom */}
      <mesh position={[-0.95, 0, 0]}>
        <boxGeometry args={[0.9, 0.08, 0.08]} />
        <meshStandardMaterial color="#152031" />
      </mesh>

      {/* V-tail */}
      <mesh position={[-1.35, 0.18, 0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.3, 0.45, 0.04]} />
        <meshStandardMaterial color="#1a2538" />
      </mesh>
      <mesh position={[-1.35, 0.18, -0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.3, 0.45, 0.04]} />
        <meshStandardMaterial color="#1a2538" />
      </mesh>

      {/* Tail rotor */}
      <group position={[-1.42, 0.05, 0]}>
        <mesh>
          <torusGeometry args={[0.22, 0.03, 10, 36]} />
          <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0.7} />
        </mesh>
        <Prop position={[0, 0.04, 0]} color={PURPLE} speed={28} />
      </group>

      {/* Schematic rings */}
      <Ring radius={2.6} color={CYAN} speed={0.18} tilt={0.0} />
      <Ring radius={3.0} color={PURPLE} speed={-0.12} tilt={0.18} />
      <TickRing radius={3.4} color={CYAN} tilt={-0.05} />

      <ScanBeam />
    </group>
  );
}

function PulsingLights() {
  const cyanRef = useRef<THREE.PointLight>(null);
  const purpleRef = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (cyanRef.current) cyanRef.current.intensity = 0.5 + 0.4 * Math.sin(t * 1.4);
    if (purpleRef.current) purpleRef.current.intensity = 0.35 + 0.25 * Math.sin(t * 1.0 + Math.PI / 2);
  });
  return (
    <>
      <pointLight ref={cyanRef} position={[3, 1, 2]} color={CYAN} intensity={0.7} />
      <pointLight ref={purpleRef} position={[-3, 0.5, -2]} color={PURPLE} intensity={0.4} />
    </>
  );
}

export default function DroneScene() {
  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [3.6, 1.6, 4.6], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 5, 3]} intensity={0.5} color={CYAN} />
        <directionalLight position={[-3, 2, -4]} intensity={0.3} color={PURPLE} />
        <PulsingLights />
        <Suspense fallback={null}>
          <Drone />
          <Particles />
        </Suspense>
      </Canvas>

      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      <span className="pointer-events-none absolute left-4 top-4 font-mono text-[10px] uppercase tracking-widest text-cyan">
        RAVEN · v0.1
      </span>
      <span className="pointer-events-none absolute right-4 top-4 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-dim">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
        LIVE TELEM
      </span>
      <span className="pointer-events-none absolute bottom-4 left-4 font-mono text-[10px] uppercase tracking-widest text-purple">
        STAGE 01 / 08
      </span>
      <span className="pointer-events-none absolute bottom-4 right-4 font-mono text-[10px] uppercase tracking-widest text-ink-dim">
        TILT-ROTOR · 3M
      </span>

      <ScanLineOverlay />
    </div>
  );
}

function ScanLineOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgb(61 224 255 / 0.03) 3px, rgb(61 224 255 / 0.03) 4px)',
        maskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
      }}
    />
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'pointer-events-none absolute h-5 w-5 border-cyan/60';
  const map: Record<typeof pos, string> = {
    tl: 'top-2 left-2 border-l border-t',
    tr: 'top-2 right-2 border-r border-t',
    bl: 'bottom-2 left-2 border-l border-b',
    br: 'bottom-2 right-2 border-r border-b',
  };
  return <span className={`${base} ${map[pos]}`} />;
}
