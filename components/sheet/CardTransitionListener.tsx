'use client';

// Imported for its side effect: lib/cardTransition.ts adds its popstate listener when it is first
// evaluated, and that listener must come before the App Router's (see onPopState there).
import '@/lib/cardTransition';

/**
 * Renders nothing. app/(site)/layout.tsx places it on every public page, so lib/cardTransition.ts
 * is evaluated during the first hydration, before the App Router adds its own popstate listener,
 * whichever page the visit begins on. Without it, a visit that began on a page with no card or
 * project cover (/about, /experience, /contact, /log) loaded the module only on reaching one, after
 * the router's listener, and the browser's Back never ran the card transition in reverse
 * (motion sheet 7.3).
 */
export default function CardTransitionListener(): null {
  return null;
}
