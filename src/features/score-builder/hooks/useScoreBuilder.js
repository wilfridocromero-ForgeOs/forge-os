import { useMemo, useState } from "react";

const blankTemplate = {
  name: "",
  division_id: "",
  description: "",
};

export default function useScoreBuilder() {
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [draft, setDraft] = useState(blankTemplate);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [library, setLibrary] = useState([]);
  const [favorites, setFavorites] = useState([]);

  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("all");

  const [view, setView] = useState("builder");

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");

  function notify(text, type = "success") {
    setMessage(text);
    setMessageType(type);
  }

  const selected = useMemo(
    () => templates.find((item) => item.id === selectedId),
    [templates, selectedId]
  );

  function updateSelected(changes) {
    setTemplates((current) =>
      current.map((item) =>
        item.id === selectedId
          ? { ...item, ...changes }
          : item
      )
    );
  }

  return {
    templates,
    setTemplates,

    selected,
    selectedId,
    setSelectedId,

    draft,
    setDraft,

    loading,
    setLoading,

    saving,
    setSaving,

    library,
    setLibrary,

    favorites,
    setFavorites,

    librarySearch,
    setLibrarySearch,

    libraryCategory,
    setLibraryCategory,

    view,
    setView,

    message,
    messageType,
    notify,

    updateSelected,
  };
}