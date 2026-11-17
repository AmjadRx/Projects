'use client';

import { Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { aspectOf, type EmbedInfo, type ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import Poster from '../shared/Poster';
import ViewerFrame from '../shared/ViewerFrame';
import { useDocumentVisible } from '../shared/hooks';
import { claimPlayback, registerPlayer } from './playback';
import styles from './VideoPlayer.module.css';

/** The one player host per provider (docs/V3_PLAN.md D-45). */
const PLAYER_ORIGINS: Record<EmbedInfo['provider'], string> = {
  YouTube: 'https://www.youtube-nocookie.com',
  Vimeo: 'https://player.vimeo.com',
};

/** True when the player address sits on its provider's one host, over HTTPS. */
function isAllowedPlayer(embed: EmbedInfo): boolean {
  try {
    return new URL(embed.embedUrl).origin === PLAYER_ORIGINS[embed.provider];
  } catch {
    return false;
  }
}

/**
 * The address the frame loads. YouTube's player takes pause messages only with its message API
 * on, so it is asked for that, with this page as the origin.
 */
function playerAddress(embed: EmbedInfo): string {
  const url = new URL(embed.embedUrl);
  if (embed.provider === 'YouTube') {
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
  }
  return url.toString();
}

function pauseMessage(provider: EmbedInfo['provider']): string {
  return provider === 'YouTube'
    ? JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] })
    : JSON.stringify({ method: 'pause' });
}

/**
 * A YouTube or Vimeo video (docs/V3_PLAN.md D-45). The page shows the self-hosted poster (or the
 * placeholder) with a notice and a load button; the provider's player loads only after that
 * click, so nothing from the provider reaches the visitor before it. There is no download link:
 * the toolbar links to the video's page on the provider's site instead.
 */
export default function EmbedPlayer({ media, takeFocus = false }: { media: ResolvedMedia; takeFocus?: boolean }) {
  const embed = media.embed && isAllowedPlayer(media.embed) ? media.embed : undefined;
  const [address, setAddress] = useState<string | null>(null);
  const loadRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const visible = useDocumentVisible();
  const id = useId();
  const loaded = address !== null;
  const provider = embed?.provider;

  // A lightbox opened on this video gives the load button focus (after the dialog's own first focus).
  useEffect(() => {
    if (!takeFocus) return undefined;
    const frame = requestAnimationFrame(() => loadRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [takeFocus]);

  // Once loaded, focus moves into the player, and the player joins the one-at-a-time rule.
  useEffect(() => {
    if (!loaded || !provider) return undefined;
    iframeRef.current?.focus({ preventScroll: true });
    const pause = () => iframeRef.current?.contentWindow?.postMessage(pauseMessage(provider), PLAYER_ORIGINS[provider]);
    const unregister = registerPlayer(id, pause);
    claimPlayback(id);
    return unregister;
  }, [id, loaded, provider]);

  // A hidden tab pauses the player (docs/V3_PLAN.md D-66).
  useEffect(() => {
    if (visible || !loaded || !provider) return;
    iframeRef.current?.contentWindow?.postMessage(pauseMessage(provider), PLAYER_ORIGINS[provider]);
  }, [visible, loaded, provider]);

  // resolveMedia passes an embed only when it parsed a YouTube or Vimeo address (docs/V3_PLAN.md
  // D-45), so this is a guard: anything else renders nothing.
  if (!embed) return null;

  const aspect = aspectOf(media, 16 / 9);
  const description = media.alt || undefined;

  const title = media.caption?.trim() || media.alt.trim() || UI.viewers.video.embedTitle(embed.provider);
  return (
    <ViewerFrame
      label={UI.viewers.video.videoFallback}
      aspect={aspect}
      caption={media.caption}
      description={description}
      allowFullscreen={loaded}
      toolbar={
        <a href={embed.watchUrl} rel="noopener noreferrer" className="download-link">
          {UI.viewers.video.watchOn(embed.provider)}
        </a>
      }
    >
      {loaded ? (
        <iframe
          ref={iframeRef}
          className={styles.iframe}
          src={address}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <>
          {/* Without a poster, the bare grid: the placeholder's icon would sit under the button. */}
          {media.poster ? <Poster media={media} /> : <div className="viewer-placeholder" aria-hidden="true" />}
          <div className={styles.gate}>
            <button
              ref={loadRef}
              type="button"
              className="viewer-tap__button"
              onClick={() => setAddress(playerAddress(embed))}
            >
              <Play size={18} aria-hidden />
              <span>{UI.viewers.video.loadEmbed(embed.provider)}</span>
            </button>
            <p className={styles.notice}>{UI.viewers.video.embedNotice(embed.provider)}</p>
          </div>
        </>
      )}
    </ViewerFrame>
  );
}
