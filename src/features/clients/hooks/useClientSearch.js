import { useMemo, useState } from "react";

export default function useClientSearch(clients) {
  const [search, setSearch] = useState("");

  const filteredClients = useMemo(() => {
    console.log("Texto:", search);
    console.log("Clientes:", clients);

    if (!search.trim()) return clients;

    const value = search.toLowerCase();

    return clients.filter((client) => {
      return (
        client.name?.toLowerCase().includes(value) ||
        client.company?.toLowerCase().includes(value) ||
        client.email?.toLowerCase().includes(value) ||
        client.phone?.toLowerCase().includes(value)
      );
    });
  }, [clients, search]);

  return {
    search,
    setSearch,
    filteredClients,
  };
}