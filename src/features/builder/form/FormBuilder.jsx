import { useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDown, ArrowLeft, ArrowUp, CheckSquare, Copy, FormInput, List, Mail, Phone, Save, Trash2, Type } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { loadBuilderAssetDraft, saveBuilderFormDraft } from "../services/BuilderAssetService.js";
import { FORM_FIELD_TYPES, createFormDocument, createFormField } from "./formDocument.js";
import FormRenderer from "./FormRenderer.jsx";
import "./FormBuilder.css";

const ICONS = { text: Type, email: Mail, tel: Phone, textarea: AlignLeft, select: List, checkbox: CheckSquare };
const clone = (value) => structuredClone(value);

export default function FormBuilder({ asset }) {
  const navigate = useNavigate();
  const [formDocument, setFormDocument] = useState(null);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const revisionRef = useRef(1);
  const latestRef = useRef(null);
  const saveTimerRef = useRef(null);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadBuilderAssetDraft(asset.id).then((draft) => {
      if (!active) return;
      const next = draft.document?.document_type === "form" ? draft.document : createFormDocument();
      latestRef.current = next;
      revisionRef.current = draft.revision || 1;
      setFormDocument(next);
      setStatus("saved");
    }).catch((value) => {
      setError(value.message || "No se pudo cargar el formulario.");
      setStatus("error");
    });

    return () => {
      active = false;
      clearTimeout(saveTimerRef.current);
    };
  }, [asset.id]);

  function schedule(next) {
    latestRef.current = next;
    setFormDocument(next);
    setStatus("unsaved");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(), 650);
  }

  async function persist() {
    clearTimeout(saveTimerRef.current);
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }

    savingRef.current = true;
    setStatus("saving");

    try {
      const current = latestRef.current;
      const saved = await saveBuilderFormDraft({
        assetId: asset.id,
        expectedRevision: revisionRef.current,
        document: current,
      });
      revisionRef.current = saved.revision;
      setError("");

      if (queuedRef.current || current !== latestRef.current) {
        queuedRef.current = false;
        savingRef.current = false;
        return persist();
      }

      setStatus("saved");
    } catch (value) {
      setStatus("error");
      setError(value.message === "BUILDER_DRAFT_CONFLICT"
        ? "El formulario cambió en otra sesión. Recarga la página antes de continuar."
        : (value.message || "No se pudo guardar el formulario."));
    } finally {
      savingRef.current = false;
    }
  }

  function addField(type) {
    const next = clone(formDocument);
    const field = createFormField(type);
    next.fields.push(field);
    setSelectedFieldId(field.id);
    schedule(next);
    requestAnimationFrame(() => globalThis.document?.getElementById(`form-field-${field.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  }

  function updateField(changes) {
    if (!selectedFieldId) return;
    const next = clone(formDocument);
    const field = next.fields.find((item) => item.id === selectedFieldId);
    if (!field) return;
    Object.assign(field, changes);
    schedule(next);
  }

  function removeField() {
    if (!selectedFieldId) return;
    const next = clone(formDocument);
    next.fields = next.fields.filter((field) => field.id !== selectedFieldId);
    setSelectedFieldId(null);
    schedule(next);
  }

  function duplicateField() {
    if (!selectedFieldId) return;
    const next = clone(formDocument);
    const index = next.fields.findIndex((field) => field.id === selectedFieldId);
    if (index < 0) return;
    const copy = { ...clone(next.fields[index]), id: crypto.randomUUID(), label: `${next.fields[index].label} copia` };
    next.fields.splice(index + 1, 0, copy);
    setSelectedFieldId(copy.id);
    schedule(next);
  }

  function moveField(delta) {
    if (!selectedFieldId) return;
    const next = clone(formDocument);
    const index = next.fields.findIndex((field) => field.id === selectedFieldId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.fields.length) return;
    [next.fields[index], next.fields[target]] = [next.fields[target], next.fields[index]];
    schedule(next);
  }

  function dropField(sourceId, targetId) {
    const next = clone(formDocument);
    const sourceIndex = next.fields.findIndex((field) => field.id === sourceId);
    const targetIndex = next.fields.findIndex((field) => field.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [moving] = next.fields.splice(sourceIndex, 1);
    const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    next.fields.splice(adjustedTarget, 0, moving);
    setSelectedFieldId(sourceId);
    schedule(next);
  }

  function updateSettings(changes) {
    const next = clone(formDocument);
    next.settings = { ...next.settings, ...changes };
    schedule(next);
  }

  const selected = useMemo(
    () => formDocument?.fields.find((field) => field.id === selectedFieldId) || null,
    [formDocument, selectedFieldId]
  );

  if (!formDocument) return <div className="form-builder-state">{error || "Cargando Form Builder…"}</div>;

  return <div className="form-builder">
    <header className="form-builder-topbar">
      <button
        type="button"
        className="form-builder-back"
        onClick={async () => {
          if (status === "unsaved") await persist();
          navigate("/construir");
        }}
      ><ArrowLeft/></button>

      <div className="form-builder-title">
        <span>BUILDER · FORMULARIO</span>
        <strong>{asset.name}</strong>
      </div>

      <div className="form-builder-save">
        <span data-status={status}>
          {status === "saved" ? "Guardado" : status === "saving" ? "Guardando…" : status === "unsaved" ? "Sin guardar" : "Error"}
        </span>
        <button type="button" onClick={() => persist()} title="Guardar ahora"><Save/></button>
      </div>
    </header>

    {error && <div className="form-builder-error">{error}</div>}

    <div className="form-builder-workspace">
      <aside className="form-builder-palette">
        <div className="form-builder-panel-head">
          <span>AÑADIR CAMPOS</span>
          <strong>Construye tu formulario</strong>
          <p>Toca un campo para añadirlo. Luego ordénalo directamente en el canvas.</p>
        </div>

        <div className="form-builder-field-list">
          {FORM_FIELD_TYPES.map(({ type, label }) => {
            const Icon = ICONS[type] || FormInput;
            return <button key={type} type="button" onClick={() => addField(type)}>
              <Icon/>
              <span>
                <strong>{label}</strong>
                <small>{["select", "radio"].includes(type) ? "Lista de opciones" : type === "checkbox" ? "Consentimiento / aceptación" : "Campo de entrada"}</small>
              </span>
              <span>＋</span>
            </button>;
          })}
        </div>
      </aside>

      <main className="form-builder-canvas">
        <div className="form-builder-canvas-head">
          <div><span>VISTA DEL FORMULARIO</span><small>Arrastra campos para reordenarlos</small></div>
          <strong>{formDocument.fields.length} campos</strong>
        </div>

        <div className="form-builder-canvas-card">
          <FormRenderer
            document={formDocument}
            editorMode
            draggableFields
            selectedFieldId={selectedFieldId}
            onFieldClick={setSelectedFieldId}
            onFieldDrop={dropField}
          />
        </div>
      </main>

      <aside className="form-builder-inspector">
        {selected ? <>
          <div className="form-builder-panel-head">
            <span>CAMPO</span>
            <strong>{selected.label || "Sin título"}</strong>
            <p>Configura qué información pedirá este campo y cómo ocupará el formulario.</p>
          </div>

          <label>Etiqueta<input value={selected.label} onChange={(event) => updateField({ label: event.target.value })}/></label>
          {selected.type !== "checkbox" && <label>Placeholder<input value={selected.placeholder || ""} onChange={(event) => updateField({ placeholder: event.target.value })}/></label>}

          <div className="form-builder-inline">
            <label><input type="checkbox" checked={Boolean(selected.required)} onChange={(event) => updateField({ required: event.target.checked })}/> Requerido</label>
            <label><input type="checkbox" checked={selected.width === "half"} onChange={(event) => updateField({ width: event.target.checked ? "half" : "full" })}/> ½ columna</label>
          </div>

          {["select", "radio"].includes(selected.type) && <label>Opciones
            <textarea
              rows={7}
              value={(selected.options || []).join("\n")}
              onChange={(event) => updateField({
                options: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 30),
              })}
            />
            <small>Una opción por línea.</small>
          </label>}

          <div className="form-builder-actions">
            <button type="button" onClick={() => moveField(-1)}><ArrowUp/> Subir</button>
            <button type="button" onClick={() => moveField(1)}><ArrowDown/> Bajar</button>
            <button type="button" onClick={duplicateField}><Copy/> Duplicar</button>
            <button type="button" className="is-danger" onClick={removeField}><Trash2/> Eliminar</button>
          </div>
        </> : <>
          <div className="form-builder-panel-head">
            <span>FORMULARIO</span>
            <strong>Configuración general</strong>
            <p>Selecciona un campo en el canvas para editarlo. Aquí controlas el formulario completo.</p>
          </div>

          <label>Texto del botón<input value={formDocument.settings.submit_label || ""} onChange={(event) => updateSettings({ submit_label: event.target.value })}/></label>
          <label>Mensaje al completar<textarea rows={4} value={formDocument.settings.success_message || ""} onChange={(event) => updateSettings({ success_message: event.target.value })}/></label>

          <div className="form-builder-style-title">ESTILO</div>
          <div className="form-builder-style-grid">
            {[
              ["clean_light","Clean Light","Tarjeta clara y legible",{card_background:"#ffffff",field_background:"#ffffff",label_color:"#27251f",input_color:"#171612",border_color:"#dedbd2",field_border:"#d8d5cc",shadow:"soft"}],
              ["dark","Dark","Superficie oscura",{card_background:"#171717",field_background:"#222222",label_color:"#f5f3ed",input_color:"#ffffff",placeholder_color:"#aaa69d",border_color:"#383838",field_border:"#4a4a4a",shadow:"elevated"}],
              ["soft_card","Soft Card","Tarjeta suave",{card_background:"#f5f1e8",field_background:"#ffffff",label_color:"#29251c",input_color:"#171612",border_color:"#ebe1cc",field_border:"#dcd4c5",shadow:"soft"}],
              ["minimal","Minimal","Contenedor mínimo",{card_background:"#ffffff",field_background:"#ffffff",label_color:"#27251f",input_color:"#171612",shadow:"none"}],
              ["glass","Glass","Transparencia sutil",{card_background:"#ffffffd9",field_background:"#ffffff",label_color:"#27251f",input_color:"#171612",shadow:"soft"}],
            ].map(([id, name, description, preset]) => <button
              key={id}
              type="button"
              className={(formDocument.settings.style_preset || "clean_light") === id ? "is-active" : ""}
              onClick={() => updateSettings({ style_preset: id, inherit_page_theme: false, ...preset })}
            ><span data-style={id}></span><strong>{name}</strong><small>{description}</small></button>)}
          </div>
          <label><input type="checkbox" checked={Boolean(formDocument.settings.inherit_page_theme)} onChange={(event) => updateSettings({ inherit_page_theme: event.target.checked })}/> Heredar tema de la página</label>
          <label>Columnas<select value={formDocument.settings.layout || "stack"} onChange={(event)=>updateSettings({layout:event.target.value})}><option value="stack">1 columna</option><option value="two_column">2 columnas</option></select></label>
          <label>Espaciado vertical<select value={formDocument.settings.vertical_spacing || "md"} onChange={(event)=>updateSettings({vertical_spacing:event.target.value})}>{["sm","md","lg"].map((id)=><option key={id}>{id}</option>)}</select></label>
          <label>Alineación del botón<select value={formDocument.settings.button_alignment || "start"} onChange={(event)=>updateSettings({button_alignment:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>
          <label><input type="checkbox" checked={(formDocument.settings.button_width || "auto") === "full"} onChange={(event)=>updateSettings({button_width:event.target.checked?"full":"auto"})}/> Botón a ancho completo</label>

          <div className="form-builder-future">
            <span>CONEXIÓN</span>
            <strong>Embudo / Leads</strong>
            <p>El diseño y los campos quedan como un asset reutilizable. Más adelante conectaremos cada envío con Leads, CRM y el embudo de ORVESEN.</p>
          </div>
        </>}
      </aside>
    </div>
  </div>;
}
