import type { BrandThesis } from '@/lib/types';

export default function BrandThesisSection({ thesis }: { thesis: BrandThesis }) {
  return (
    <section id="thesis" className="relative section">
      <div className="wrap relative">
        <div className="mx-auto max-w-[1080px]">
          <div className="flex flex-col items-start gap-3">
            <span className="eyebrow">
              <span className="eyebrow-num">003</span>
              <span className="eyebrow-rule" />
              <span>The thesis</span>
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">
              EV power electronics → autonomous aerospace
            </span>
          </div>

          <h2 className="display-2xl text-balance mt-8 max-w-[22ch] text-fg">
            <span className="editorial italic text-fg-dim">&ldquo;</span>
            {thesis.headline}
            <span className="editorial italic text-fg-dim">&rdquo;</span>
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-14">
            <div className="md:col-span-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
                Why this works
              </span>
              <div className="mt-3 flex items-center gap-2 text-accent">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(var(--accent))' }} />
                <span className="font-mono text-[11px] uppercase tracking-[0.2em]">Same stack</span>
              </div>
            </div>
            <div className="md:col-span-9">
              <p className="text-pretty text-lg leading-[1.55] text-fg-dim md:text-xl lg:text-[1.4rem]">
                {thesis.body}
              </p>
            </div>
          </div>

          <div className="mt-14 grid grid-cols-2 gap-8 md:mt-20 md:grid-cols-4 md:gap-10">
            {pillars.map((p) => (
              <div key={p.label} className="border-l border-line/10 pl-4 md:pl-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                  {p.tag}
                </div>
                <div className="mt-2 text-base font-medium text-fg md:text-lg">
                  {p.label}
                </div>
                <div className="mt-1 text-sm text-fg-mute md:text-[15px]">
                  {p.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const pillars = [
  { tag: 'A', label: 'Power electronics', desc: '420 V / 540 V BMS, charging, IMD' },
  { tag: 'B', label: 'Motor inverter math', desc: 'PWM · space-vector modulation · ESC' },
  { tag: 'C', label: 'Firmware discipline', desc: 'STM32 · Lauterbach JTAG · CAN' },
  { tag: 'D', label: 'Systems craft', desc: 'PCB safety review · thermal · integration' },
];
