'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const CYAN = '#3DE0FF';
const PURPLE = '#7C5CFF';
const INK = '#f6f8fc';

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
        <cylinderGeometry args={[0.07, 0.07, 0.06, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.25, 0.015, 0.07]} />
        <meshStandardMaterial color={INK} transparent opacity={0.78} />
      </mesh>
    </group>
  );
}

function Ring({
  radius,
  color,
  speed,
  tilt,
  thickness = 0.008,
  opacity = 0.4,
}: {
  radius: number;
  color: string;
  speed: number;
  tilt: number;
  thickness?: number;
  opacity?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2 + tilt, 0, 0]}>
      <torusGeometry args={[radius, thickness, 8, 128]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

function Particles() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 180;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 7;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.03;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.018} color={CYAN} transparent opacity={0.45} sizeAttenuation />
    </points>
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
    group.current.rotation.x = current.current.y * 0.2 + Math.sin(t * 0.5) * 0.03;
    group.current.rotation.z = Math.sin(t * 0.35) * 0.03;
    group.current.rotation.y = hovered
      ? group.current.rotation.y + (current.current.x * 0.4 - group.current.rotation.y) * 4 * dt
      : group.current.rotation.y + dt * 0.16;
    group.current.position.y = Math.sin(t * 0.9) * 0.14;
  });

  return (
    <group
      ref={group}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerMove={(e) => {
        const rect = gl.domElement.getBoundingClientRect();
        target.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        target.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      }}
    >
      {/* Fuselage */}
      <mesh>
        <boxGeometry args={[1.6, 0.3, 0.5]} />
        <meshStandardMaterial color="#0e1422" metalness={0.5} roughness={0.5} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(1.62, 0.32, 0.52)]} />
        <lineBasicMaterial color={CYAN} transparent opacity={0.8} />
      </lineSegments>

      {/* Nose */}
      <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.2, 0.4, 16]} />
        <meshStandardMaterial color="#080c14" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[1.13, 0, 0]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1.6} />
      </mesh>

      {/* Wings */}
      <mesh>
        <boxGeometry args={[0.6, 0.045, 3.4]} />
        <meshStandardMaterial color="#10172a" metalness={0.4} roughness={0.55} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(0.62, 0.055, 3.42)]} />
        <lineBasicMaterial color={CYAN} transparent opacity={0.4} />
      </lineSegments>

      {/* Wing-tip rotors */}
      <group position={[0, 0.11, 1.7]}>
        <mesh>
          <torusGeometry args={[0.3, 0.035, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.6} />
        </mesh>
        <Prop position={[0, 0.05, 0]} color={CYAN} />
      </group>
      <group position={[0, 0.11, -1.7]}>
        <mesh>
          <torusGeometry args={[0.3, 0.035, 12, 48]} />
          <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.6} />
        </mesh>
        <Prop position={[0, 0.05, 0]} color={CYAN} reverse />
      </group>

      {/* Tail boom */}
      <mesh position={[-0.95, 0, 0]}>
        <boxGeometry args={[0.9, 0.07, 0.07]} />
        <meshStandardMaterial color="#0f1626" />
      </mesh>

      {/* V-tail */}
      <mesh position={[-1.35, 0.18, 0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.28, 0.42, 0.035]} />
        <meshStandardMaterial color="#141d31" />
      </mesh>
      <mesh position={[-1.35, 0.18, -0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.28, 0.42, 0.035]} />
        <meshStandardMaterial color="#141d31" />
      </mesh>

      {/* Tail rotor */}
      <group position={[-1.42, 0.05, 0]}>
        <mesh>
          <torusGeometry args={[0.2, 0.025, 10, 36]} />
          <meshStandardMaterial color={PURPLE} emissive={PURPLE} emissiveIntensity={0.7} />
        </mesh>
        <Prop position={[0, 0.04, 0]} color={PURPLE} speed={28} />
      </group>

      <Ring radius={2.5} color={CYAN} speed={0.18} tilt={0.0} opacity={0.5} />
      <Ring radius={3.0} color={PURPLE} speed={-0.12} tilt={0.18} opacity={0.35} />
    </group>
  );
}

function PulsingLights() {
  const cyanRef = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    if (cyanRef.current) {
      cyanRef.current.intensity = 0.4 + 0.3 * Math.sin(state.clock.getElapsedTime() * 1.2);
    }
  });
  return (
    <>
      <pointLight ref={cyanRef} position={[3, 1, 2]} color={CYAN} intensity={0.6} />
      <pointLight position={[-3, 0.5, -2]} color={PURPLE} intensity={0.3} />
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
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 5, 3]} intensity={0.45} color={CYAN} />
        <directionalLight position={[-3, 2, -4]} intensity={0.25} color={PURPLE} />
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

      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan">
          RAVEN · v0.1
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
          LIVE TELEM
        </span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">
          STAGE 01 / 08
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">
          TILT-ROTOR · 3M
        </span>
      </div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'pointer-events-none absolute h-4 w-4';
  const map: Record<typeof pos, string> = {
    tl: 'top-2 left-2 border-l border-t',
    tr: 'top-2 right-2 border-r border-t',
    bl: 'bottom-2 left-2 border-l border-b',
    br: 'bottom-2 right-2 border-r border-b',
  };
  return (
    <span
      className={`${base} ${map[pos]}`}
      style={{ borderColor: 'rgb(61 224 255 / 0.55)' }}
    />
  );
}
