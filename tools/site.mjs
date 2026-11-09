// site.mjs - where the site is served from. The preview lives in a sub-folder and must not be indexed (bitz.ge still runs WordPress);
// going live = BITZ_BASE=/ and BITZ_INDEX=1 in the deploy (a separate, explicit step).
export const ORIGIN = 'https://bitz.ge';
export const BASE = (process.env.BITZ_BASE || '/preview/bitz/').replace(/\/*$/, '/');
export const INDEX = process.env.BITZ_INDEX === '1';
