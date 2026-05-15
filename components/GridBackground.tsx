'use client';

export default function GridBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(61 224 255 / 0.07) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgb(61 224 255 / 0.07) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 75%)',
        }}
      />
      <div className="absolute -top-32 left-1/2 h-72 w-[60%] -translate-x-1/2 rounded-full bg-cyan/8 blur-3xl" />
      <div className="absolute -top-10 left-[10%] h-40 w-40 rounded-full bg-purple/15 blur-3xl animate-pulse" />
      <div className="absolute top-32 right-[12%] h-48 w-48 rounded-full bg-cyan/10 blur-3xl animate-pulse" style={{ animationDuration: '5s' }} />
      <svg
        className="absolute left-0 top-12 h-16 w-32 text-cyan/30"
        viewBox="0 0 200 80"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <path d="M0,40 Q40,10 80,40 T160,40 T240,40" />
      </svg>
    </div>
  );
}
