/** Web Analytics never records the admin or the development pages (docs/V3_PLAN.md Q-36). */
import { describe, expect, it } from 'vitest';
import { dropPrivatePages } from '../components/site/SiteAnalytics';

const view = (url: string) => ({ type: 'pageview' as const, url });

describe('the analytics filter', () => {
  it('drops the admin and the development pages', () => {
    for (const url of [
      'https://amjadrehawi.com/admin',
      'https://amjadrehawi.com/admin#tab=projects&project=raven',
      'https://amjadrehawi.com/admin/anything',
      'https://amjadrehawi.com/dev/blocks',
      'https://amjadrehawi.com/dev-sky?still=1',
      'https://amjadrehawi.com/dev-convert',
    ]) {
      expect(dropPrivatePages(view(url)), url).toBeNull();
    }
  });

  it('keeps every public page, including ones whose names start alike', () => {
    for (const url of ['https://amjadrehawi.com/', 'https://amjadrehawi.com/projects/raven', 'https://amjadrehawi.com/administration', 'https://amjadrehawi.com/devices']) {
      expect(dropPrivatePages(view(url)), url).not.toBeNull();
    }
  });
});
