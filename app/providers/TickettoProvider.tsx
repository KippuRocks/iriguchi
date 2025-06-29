"use client";

import { useEffect, useState } from "react";

import { TickettoClientBuilder } from "@ticketto/protocol";
import { type AccountId } from "@ticketto/types";
import { TickettoClientProvider } from "./TickettoClientProvider";
import { KippuConfig, KippuPAPIConsumer } from "@kippurocks/libticketto-papi";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";

export function TickettoProvider({
  accountId,
  children,
}: {
  accountId?: AccountId;
  children: React.ReactNode;
}) {
  const [isClientSide, setIsClientSide] = useState(false);
  const builder = new TickettoClientBuilder()
    .withConsumer(KippuPAPIConsumer)
    .withConfig({
      consumerSettings: {
        apiEndpoint: process.env.NEXT_PUBLIC_KIPPU_API,
        client: createClient(
          getWsProvider(
            process.env.NEXT_PUBLIC_CHAIN_ENDPOINT ?? "wss://kreivo.kippu.rocks"
          )
        ),
        eventsContractAddress: process.env.NEXT_PUBLIC_EVENTS_CONTRACT_ADDRESS,
        ticketsContractAddress:
          process.env.NEXT_PUBLIC_TICKETS_CONTRACT_ADDRESS,
        merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID,
      },
      accountProvider: {
        getAccountId: () => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
        sign() {
          throw new Error("NotImplemented");
        },
      },
    } as KippuConfig);

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
