/**
 * A caption line from a name (a block's title) and the content's caption: "Name: caption", or
 * whichever of the two exists. A name that already ends in punctuation takes no colon.
 */
export function captionLine(name: string | undefined, caption: string | undefined): string | undefined {
  const n = name?.trim() || undefined;
  const c = caption?.trim() || undefined;
  if (!n) return c;
  if (!c) return n;
  return /[.:;?!]$/.test(n) ? `${n} ${c}` : `${n}: ${c}`;
}
