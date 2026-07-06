'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

interface Palette {
  accent: string;
  accent2: string;
  body: string;
  bodyDark: string;
  blade: string;
}

const DARK: Palette = {
  accent: '#3DE0FF',
  accent2: '#7C5CFF',
  body: '#151d2e',
  bodyDark: '#0d1320',
  blade: '#e9eef8',
};

const LIGHT: Palette = {
  accent: '#0B8FB3',
  accent2: '#5B3FE0',
  body: '#28324a',
  bodyDark: '#1a2236',
  blade: '#3d4657',
};

function useTheme(): Palette {
  const [palette, setPalette] = useState<Palette>(DARK);
  useEffect(() => {
    const read = () =>
      setPalette(document.documentElement.dataset.theme === 'light' ? LIGHT : DARK);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function Prop({ position, color, reverse, speed = 20 }: {
  position: [number, number, number];
  color: string;
  reverse?: boolean;
  speed?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += (reverse ? -1 : 1) * dt * speed;
  });
  return (
    <group ref={ref} position={position}>
      <mesh>
        <cylinderGeometry args={[0.07, 0.07, 0.06, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.25, 0.015, 0.07]} />
        <meshStandardMaterial color="#8a94a8" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function Ring({ radius, color, speed, tilt, opacity }: {
  radius: number;
  color: string;
  speed: number;
  tilt: number;
  opacity: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2 + tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.008, 8, 128]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

function Particles({ color }: { color: string }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 13;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 7;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 7 - 2;
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.025;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color={color} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

function Drone({ palette }: { palette: Palette }) {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  const edges = useMemo(
    () => ({
      fuselage: new THREE.EdgesGeometry(new THREE.BoxGeometry(1.62, 0.32, 0.52)),
      wing: new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 0.055, 3.42)),
    }),
    [],
  );

  useFrame((state, dt) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    current.current.x += (target.current.x - current.current.x) * 4 * dt;
    current.current.y += (target.current.y - current.current.y) * 4 * dt;
    // parallax capped ≈6°
    group.current.rotation.x = current.current.y * 0.1 + Math.sin(t * 0.5) * 0.02;
    group.current.rotation.z = Math.sin(t * 0.35) * 0.02;
    group.current.rotation.y += dt * 0.14 + current.current.x * 0.002;
    group.current.position.y = Math.sin(t * 0.9) * 0.12;
  });

  return (
    <group
      ref={group}
      onPointerMove={(e) => {
        const rect = gl.domElement.getBoundingClientRect();
        target.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        target.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      }}
    >
      <mesh>
        <boxGeometry args={[1.6, 0.3, 0.5]} />
        <meshStandardMaterial color={palette.body} metalness={0.4} roughness={0.6} />
      </mesh>
      <lineSegments geometry={edges.fuselage}>
        <lineBasicMaterial color={palette.accent} transparent opacity={0.7} />
      </lineSegments>

      <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.2, 0.4, 16]} />
        <meshStandardMaterial color={palette.bodyDark} metalness={0.5} roughness={0.5} />
      </mesh>

      <mesh>
        <boxGeometry args={[0.6, 0.045, 3.4]} />
        <meshStandardMaterial color={palette.body} metalness={0.35} roughness={0.6} />
      </mesh>
      <lineSegments geometry={edges.wing}>
        <lineBasicMaterial color={palette.accent} transparent opacity={0.35} />
      </lineSegments>

      {([1.7, -1.7] as const).map((z, i) => (
        <group key={z} position={[0, 0.11, z]}>
          <mesh>
            <torusGeometry args={[0.3, 0.03, 12, 48]} />
            <meshStandardMaterial
              color={palette.accent}
              emissive={palette.accent}
              emissiveIntensity={0.45}
            />
          </mesh>
          <Prop position={[0, 0.05, 0]} color={palette.accent} reverse={i === 1} />
        </group>
      ))}

      <mesh position={[-0.95, 0, 0]}>
        <boxGeometry args={[0.9, 0.07, 0.07]} />
        <meshStandardMaterial color={palette.body} />
      </mesh>
      <mesh position={[-1.35, 0.18, 0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.28, 0.42, 0.035]} />
        <meshStandardMaterial color={palette.body} />
      </mesh>
      <mesh position={[-1.35, 0.18, -0.22]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.28, 0.42, 0.035]} />
        <meshStandardMaterial color={palette.body} />
      </mesh>

      <group position={[-1.42, 0.05, 0]}>
        <mesh>
          <torusGeometry args={[0.2, 0.025, 10, 36]} />
          <meshStandardMaterial
            color={palette.accent2}
            emissive={palette.accent2}
            emissiveIntensity={0.5}
          />
        </mesh>
        <Prop position={[0, 0.04, 0]} color={palette.accent2} speed={26} />
      </group>

      <Ring radius={2.5} color={palette.accent} speed={0.16} tilt={0} opacity={0.4} />
      <Ring radius={2.95} color={palette.accent2} speed={-0.1} tilt={0.16} opacity={0.28} />
    </group>
  );
}

export default function DroneScene() {
  const palette = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // Pause rendering when the canvas scrolls off screen.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Canvas
        camera={{ position: [3.6, 1.5, 4.6], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        frameloop={visible ? 'always' : 'never'}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 5, 3]} intensity={0.5} color={palette.accent} />
        <directionalLight position={[-3, 2, -4]} intensity={0.25} color={palette.accent2} />
        <Suspense fallback={null}>
          <Drone palette={palette} />
          <Particles color={palette.accent} />
        </Suspense>
      </Canvas>
    </div>
  );
}
