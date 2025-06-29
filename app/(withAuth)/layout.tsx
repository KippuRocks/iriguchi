import { ReactNode } from "react";
import { TickettoProvider } from "../providers/TickettoProvider";

export default async function WithAuth({ children }: { children: ReactNode }) {
  return <TickettoProvider>{children}</TickettoProvider>;
}
