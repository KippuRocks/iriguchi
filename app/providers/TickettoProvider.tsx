"use client";

import { useEffect, useState } from "react";

import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "@ticketto/web-stub";
import { type AccountId } from "@ticketto/types";
import { TickettoClientProvider } from "./TickettoClientProvider";

export function TickettoProvider({
  accountId,
  children,
}: {
  accountId?: AccountId;
  children: React.ReactNode;
}) {
  const [isClientSide, setIsClientSide] = useState(false);
  const builder = new TickettoClientBuilder()
    .withConsumer(TickettoWebStubConsumer)
    .withConfig({
      accountProvider: {
        getAccountId: () => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
        sign: (payload: Uint8Array) => Promise.resolve(payload),
      },
    });

  useEffect(() => {
    setIsClientSide(true);
  }, [accountId, builder]);

  return (
    isClientSide && (
      <TickettoClientProvider builder={builder}>
        {children}
      </TickettoClientProvider>
    )
  );
}
