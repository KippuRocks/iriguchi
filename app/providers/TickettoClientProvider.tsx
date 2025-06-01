"use client";

import "reflect-metadata";
import { createContext, ReactNode, useEffect, useState } from "react";

import { TickettoClient, TickettoClientBuilder } from "@ticketto/protocol";

export const TickettoClientContext = createContext<TickettoClient | null>(null);

export function TickettoClientProvider({
  builder,
  children,
}: {
  builder: TickettoClientBuilder;
  children: React.ReactNode;
}) {
  return <TickettoProvider builder={builder}>{children}</TickettoProvider>;
}

function TickettoProvider({
  builder,
  children,
}: {
  builder: TickettoClientBuilder;
  children: ReactNode;
}) {
  const [client, setClient] = useState<TickettoClient | null>(null);
  useEffect(() => {
    async function initialize() {
      builder.build().then((client) => setClient(client));
    }
    if (
      typeof window !== "undefined" &&
      typeof Reflect?.hasOwnMetadata !== "undefined"
    ) {
      initialize();
    }
  }, [builder]);

  if (
    typeof window === "undefined" ||
    typeof Reflect.hasOwnMetadata === "undefined"
  ) {
    return <>Loading...</>;
  }

  return (
    <TickettoClientContext.Provider value={client}>
      {children}
    </TickettoClientContext.Provider>
  );
}
