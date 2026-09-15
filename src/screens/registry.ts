/**
 * Iriguchi's screens: the router's table (T-050-10; `F-070` plan §5.4).
 *
 * Every screen has a stable `screenId`, a title, the parameters the router shows
 * it with, and its route: the deep-link path that opens it, or `null` when no
 * link opens it. No link opens Iriguchi, so every route is `null`; the field
 * stays because the manifest format carries it.
 *
 * Screen ids name what a screen is for, as `area.subject`. They never name copy,
 * positions or indices, and once used an id is not renamed: journeys,
 * screenshots and the navigation map in kippu-e2e refer to it.
 *
 * `tools/screens` reads this table, and the navigation declared in the sources,
 * to generate `screens.json`. This module imports nothing, so the tool can load
 * it without the app.
 */

export interface ScreenDefinition {
  readonly title: string;
  readonly route: string | null;
  /** The parameters the screen is shown with. */
  readonly params: readonly string[];
}

export const SCREENS = {
  "app.starting": { title: "Starting", route: null, params: [] },
  "gate.scan": { title: "Scan a pass", route: null, params: [] },
} as const satisfies Readonly<Record<string, ScreenDefinition>>;

export type ScreenId = keyof typeof SCREENS;

/** The screen the app opens on. */
export const INITIAL_SCREEN = "app.starting" satisfies ScreenId;
