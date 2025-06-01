import { ReactNode } from "react";
import { auth0 } from "../lib/auth0";
import { redirect } from "next/navigation";
import { TickettoProvider } from "../providers/TickettoProvider";

export default async function WithAuth({ children }: { children: ReactNode }) {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  return <TickettoProvider>{children}</TickettoProvider>;
}
