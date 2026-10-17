/**
 * A rough place from how someone is connected — no permission needed, no coordinates. The hosting platform adds the visitor's
 * city to each request as a header; this reads it. It is a guess (mobile networks and VPNs can put you in the wrong city), so the
 * app only ever offers it as a suggestion the person confirms with a tap.
 */

/** The city, cleaned, or null when the header is missing or not a plausible city name. */
export function cityFromHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let city = raw;
  try {
    city = decodeURIComponent(raw);
  } catch {
    /* not percent-encoded: use as is */
  }
  city = city.replace(/\s+/g, ' ').trim();
  if (city.length < 2 || city.length > 60) return null;
  // Letters (any language), spaces and the few marks real city names use. Anything else is not a place name.
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(city)) return null;
  return city;
}

export interface LocationHelp {
  title: string;
  steps: string[];
}

/**
 * How to switch location back on for this site, for the device being used. Browsers never let a page re-ask once location was
 * blocked, so the honest thing is to show the shortest path to the setting.
 */
export function locationHelp(userAgent: string): LocationHelp {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return {
      title: 'Location is off for Pexa on this iPhone',
      steps: ['Open Settings → Privacy & Security → Location Services', 'Scroll to Safari Websites (or Pexa if you added it to your home screen)', 'Choose “While Using the App”, then come back here'],
    };
  }
  if (/Android/i.test(ua)) {
    return {
      title: 'Location is off for Pexa on this phone',
      steps: ['Tap the icon at the left of the address bar (a lock or sliders) → Permissions', 'Set Location to Allow', 'Using Pexa from your home screen? Press and hold its icon → App info → Permissions → Location → Allow'],
    };
  }
  return {
    title: 'Location is off for this site',
    steps: ['Click the icon at the left of the address bar (a lock or sliders)', 'Set Location to Allow', 'Come back here — I’ll carry on by myself'],
  };
}
