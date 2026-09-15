// Iriguchi's router (T-050-10): which screen is shown, and every move between
// screens, declared where it happens so `tools/screens` can map it:
//
//   navigate("gate.scan", "gate.verdict", { ticket })
//
// names both screens as string literals — from a screen's controls, and from
// the app's state, as when a sign-in completes. No link opens Iriguchi, so
// there is no other way onto a screen.

import { useCallback, useState } from "react";
import { INITIAL_SCREEN, type SCREENS, type ScreenId } from "./registry.ts";

/** The parameters a screen is shown with. */
export type ParamsOf<Id extends ScreenId> = {
  readonly [Name in (typeof SCREENS)[Id]["params"][number]]: string;
};

export interface Location {
  readonly screen: ScreenId;
  readonly params: Readonly<Record<string, string>>;
}

export interface Router {
  readonly location: Location;
  /** Moves from the screen `from` to `to`; `from` names the screen the call is made on. */
  navigate<Id extends ScreenId>(from: ScreenId, to: Id, params: ParamsOf<Id>): void;
}

export function useRouter(): Router {
  const [location, setLocation] = useState<Location>({ screen: INITIAL_SCREEN, params: {} });
  const navigate = useCallback(
    <Id extends ScreenId>(_from: ScreenId, to: Id, params: ParamsOf<Id>) => {
      setLocation({ screen: to, params: params as Readonly<Record<string, string>> });
    },
    [],
  );
  return { location, navigate };
}
