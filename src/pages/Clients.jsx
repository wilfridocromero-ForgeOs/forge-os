import { useState } from "react";

import useClients from "../features/clients/hooks/useClients";
import useClientSearch from "../features/clients/hooks/useClientSearch";

import ClientHeader from "../features/clients/components/ClientHeader";
import ClientSearch from "../features/clients/components/ClientSearch";
import ClientList from "../features/clients/components/ClientList";
import ClientModal from "../features/clients/components/ClientModal";

function Clients() {
  const {
    clients,
    loading,
    addClient,
    editClient,
    removeClient,
  } = useClients();

  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);

  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
  });

  const {
    search,
    setSearch,
    filteredClients,
  } = useClientSearch(clients);

  const resetForm = () => {
    setForm({
      name: "",
      company: "",
      phone: "",
      email: "",
    });

    setEditingClient(null);
  };

  const saveClient = async () => {
    if (!form.name || !form.company) {
      alert("Nombre y empresa son obligatorios.");
      return;
    }

    try {
      if (editingClient) {
        await editClient(editingClient.id, form);
      } else {
        await addClient(form);
      }

      resetForm();
      setShowForm(false);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleEdit = (client) => {
    setEditingClient(client);

    setForm({
      name: client.name || "",
      company: client.company || "",
      phone: client.phone || "",
      email: client.email || "",
    });

    setShowForm(true);
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "¿Seguro que deseas eliminar este cliente?"
    );

    if (!confirmed) return;

    try {
      await removeClient(id);
    } catch (error) {
      alert(error.message);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          color: "#999",
          fontSize: "16px",
        }}
      >
        Cargando clientes...
      </div>
    );
  }

  return (
    <div>
      <ClientHeader
        onNewClient={() => {
          resetForm();
          setShowForm(true);
        }}
      />

      <ClientSearch
        search={search}
        setSearch={setSearch}
      />

      <ClientList
        clients={filteredClients}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <ClientModal
        show={showForm}
        form={form}
        setForm={setForm}
        editingClient={editingClient}
        onClose={() => {
          resetForm();
          setShowForm(false);
        }}
        onSave={saveClient}
      />
    </div>
  );
}

export default Clients;