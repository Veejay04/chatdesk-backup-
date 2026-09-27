import { createContext, useContext, useState, type ReactNode } from "react";

// Lets the Tickets screen (which fetches tickets) tell the Tabs layout
// (which owns the tab bar icon) how many resolved-but-unseen tickets there
// are, without either needing to know about the other's implementation.
type TicketBadgeContextValue = {
  unseenCount: number;
  setUnseenCount: (count: number) => void;
};

const TicketBadgeContext = createContext<TicketBadgeContextValue | null>(null);

export function TicketBadgeProvider({ children }: { children: ReactNode }) {
  const [unseenCount, setUnseenCount] = useState(0);
  return (
    <TicketBadgeContext.Provider value={{ unseenCount, setUnseenCount }}>
      {children}
    </TicketBadgeContext.Provider>
  );
}

export function useTicketBadge() {
  const context = useContext(TicketBadgeContext);
  if (!context) {
    throw new Error("useTicketBadge must be used within a TicketBadgeProvider");
  }
  return context;
}
