import Roadmap, { type RoadmapStage } from '@/components/sheet/Roadmap';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';

/**
 * A roadmap block (bundle Roadmap; ramp place 4): the stages, filled with their slice of the ramp
 * up to the current one, each naming its status in words (docs/V3_PLAN.md D-69). Named after what
 * it belongs to ("Raven roadmap") when the page gives `label`.
 */
export default function RoadmapBlock({ stages, label }: { stages: RoadmapStage[]; label?: string }) {
  if (stages.length === 0) return null;
  return <Roadmap stages={stages} label={hasText(label) ? UI.roadmap.labelFor(label) : UI.roadmap.label} />;
}
