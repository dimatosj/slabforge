import { loadDesign } from "$lib/design";
import type { PageLoad } from "./$types";

// The editor is a fully interactive WebGL/canvas app; render it client-side only
// so `load` can read the URL AND localStorage in one place with no hydration mismatch.
export const ssr = false;

export const load: PageLoad = ({ url }) => {
  return { design: loadDesign(url) };
};
