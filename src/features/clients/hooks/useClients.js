import { useCallback, useEffect, useState } from "react";

import {
  getClients,
  createClient,
  updateClient,
  deleteClient,
} from "../services/clientsService";

export default function useClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getClients();

      setClients(data ?? []);
    } catch (err) {
      console.error(err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const addClient = async (client) => {
    try {
      const newClient = await createClient(client);

      setClients((prev) => [...prev, newClient]);

      return newClient;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const editClient = async (id, updates) => {
    try {
      const updatedClient = await updateClient(id, updates);

      setClients((prev) =>
        prev.map((client) =>
          client.id === id ? updatedClient : client
        )
      );

      return updatedClient;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const removeClient = async (id) => {
    try {
      await deleteClient(id);

      setClients((prev) =>
        prev.filter((client) => client.id !== id)
      );
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  return {
    clients,
    loading,
    error,

    loadClients,

    addClient,

    editClient,

    removeClient,
  };
}