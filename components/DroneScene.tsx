'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const CYAN = '#3DE0FF';
const PURPLE = '#7C5CFF';
const INK = '#e9eef8';

function Prop({ position, color, reverse }: { position: [number, number, number]; color: string; reverse?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += (reverse ? -1 : 1) * dt * 22;
  });
  return (
    <group ref={ref} position={position}>
      <mesh>
        <cylinderGeometry args={[0.08, 0.08, 0.08, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[1.3, 0.02, 0.08]} />
        <meshStandardMaterial color={INK} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function Ring({ radius, color, speed, tilt }: { radius: number; color: string; speed: number; tilt: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2 + tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.012, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </mesh>
  );
}

function Particles() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 8;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.03;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial size={0.025} color={CYAN} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

function Drone() {
  const group = useRef<THREE.Group>(null);
  const { gl, camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useFrame((_, dt) => {
    if (!group.current) return;
    current.current.x += (target.current.x - current.current.x) * 4 * dt;
    current.current.y += (target.current.y - current.current.y) * 4 * dt;
    group.current.rotation.x = current.current.y * 0.25;
    group.current.rotation.y = current.current.x * 0.4 + (hovered ? group.current.rotation.y : group.current.rotation.y + dt * 0.18);
    group.current.position.y = Math.sin(performance.now() * 0.001) * 0.12;
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
        <lineBasicMaterial color={CYAN} transparent opacity={0.85} />
      </lineSegments>

      {/* Nose tip */}
      <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.22, 0.4, 16]} />
        <meshStandardMaterial color="#101725" />
      </mesh>

      {/* Wings */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.6, 0.05, 3.4]} />
        <meshStandardMaterial color="#152031" metalness={0.3} roughness={0.6} />
      </mesh>
      <lineSegments position={[0, 0, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(0.62, 0.06, 3.42)]} />
        <lineBasicMaterial color={CYAN} transparent opacity={0.45} />
      </lineSegments>

      {/* Wing tip rotor housings (cyan rings + props) */}
      <group position={[0, 0.12, 1.7]}>
        <mesh>
          <torusGeometry args={[0.32, 0.04, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.4} />
        </mesh>
        <Prop position={[0, 0.05, 0]} color={CYAN} />
      </group>
      <group position={[0, 0.12, -1.7]}>
        <mesh>
          <torusGeometry args={[0.32, 0.04, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.4} />
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

      {/* Tail rotor (purple accent) */}
      <group position={[-1.42, 0.05, 0]}>
        <mesh>
          <torusGeometry args={[0.22, 0.03, 10, 36]} />
          <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0.5} />
        </mesh>
        <Prop position={[0, 0.04, 0]} color={PURPLE} />
      </group>

      {/* Schematic rings around the drone */}
      <Ring radius={2.6} color={CYAN} speed={0.18} tilt={0.0} />
      <Ring radius={3.0} color={PURPLE} speed={-0.12} tilt={0.18} />
    </group>
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
        <directionalLight position={[4, 5, 3]} intensity={0.7} color={CYAN} />
        <directionalLight position={[-3, 2, -4]} intensity={0.4} color={PURPLE} />
        <Suspense fallback={null}>
          <Drone />
          <Particles />
        </Suspense>
      </Canvas>

      {/* Corner crosshair brackets */}
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      {/* Mono labels */}
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
    </div>
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
