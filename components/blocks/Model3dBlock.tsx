import ModelViewer from '@/components/viewers/model/ModelViewer';
import type { ModelView } from '@/components/viewers/types';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

const ALL_VIEWS: ModelView[] = ['realistic', 'blueprint', 'thermal'];

export default function Model3dBlock({
  media,
  views,
  explode,
  callouts,
}: {
  media: MediaRef;
  views?: ModelView[];
  explode?: boolean;
  callouts?: { label: string; value: string }[];
}) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  const offered = views && views.length > 0 ? ALL_VIEWS.filter((v) => views.includes(v)) : ALL_VIEWS;
  return (
    <ModelViewer
      media={resolved}
      views={offered.length > 0 ? offered : ALL_VIEWS}
      explode={explode !== false}
      callouts={(callouts ?? []).filter((c) => c.label.trim() !== '' && c.value.trim() !== '')}
    />
  );
}
