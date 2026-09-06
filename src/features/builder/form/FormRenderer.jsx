import "./FormRenderer.css";
import { resolveFormStyle } from "./formDocument.js";
import { appearanceData } from "../document/visualAppearance.js";

export default function FormRenderer({
  document,
  editorMode = false,
  onFieldClick = null,
  selectedFieldId = null,
  draggableFields = false,
  onFieldDrop = null,
}) {
  if (!document?.fields) return null;
  const formStyle = resolveFormStyle(document.settings);
  const style = formStyle.inherit_page_theme ? undefined : {
    "--form-bg": formStyle.background,
    "--form-card": formStyle.card_background,
    "--form-border": formStyle.border_color,
    "--form-field": formStyle.field_background,
    "--form-field-border": formStyle.field_border,
    "--form-label": formStyle.label_color,
    "--form-input": formStyle.input_color,
    "--form-placeholder": formStyle.placeholder_color,
  };

  return <form
    className="orvesen-form-renderer"
    {...appearanceData(formStyle.appearance)}
    data-style-preset={formStyle.style_preset}
    data-inherit-theme={formStyle.inherit_page_theme || undefined}
    data-radius={formStyle.radius}
    data-shadow={formStyle.shadow}
    data-padding={formStyle.padding}
    data-submit-variant={formStyle.submit_variant}
    data-layout={formStyle.layout}
    data-vertical-spacing={formStyle.vertical_spacing}
    data-button-alignment={formStyle.button_alignment}
    data-button-width={formStyle.button_width}
    style={style}
    onSubmit={(event) => event.preventDefault()}
  >
    <div className="orvesen-form-grid">
      {document.fields.map((field) => {
        const common = {
          id: `form-field-${field.id}`,
          name: field.id,
          placeholder: field.placeholder || "",
          required: Boolean(field.required),
          disabled: editorMode,
        };

        return <div
          key={field.id}
          className={`orvesen-form-field ${field.width === "half" ? "is-half" : ""} ${selectedFieldId === field.id ? "is-selected" : ""}`}
          draggable={Boolean(editorMode && draggableFields)}
          onDragStart={(event) => {
            if (!editorMode || !draggableFields) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/orvesen-form-field", field.id);
          }}
          onDragOver={(event) => {
            if (!editorMode || !draggableFields) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!editorMode || !draggableFields) return;
            event.preventDefault();
            const sourceId = event.dataTransfer.getData("text/orvesen-form-field");
            if (sourceId && sourceId !== field.id) onFieldDrop?.(sourceId, field.id);
          }}
          onClick={(event) => {
            if (!editorMode) return;
            event.preventDefault();
            event.stopPropagation();
            onFieldClick?.(field.id);
          }}
        >
          {editorMode && draggableFields && <span className="orvesen-form-drag" aria-hidden="true">⋮⋮</span>}
          {field.type !== "checkbox" && <label htmlFor={common.id}>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>}
          {field.type === "textarea" ? <textarea {...common} rows={4}/>
            : field.type === "select" ? <select {...common} defaultValue=""><option value="" disabled>{field.placeholder || "Selecciona"}</option>{(field.options || []).map((option, optionIndex) => <option key={`${option}-${optionIndex}`}>{option}</option>)}</select>
            : field.type === "radio" ? <fieldset className="orvesen-form-radio"><legend>{field.label}{field.required ? " *" : ""}</legend>{(field.options || []).map((option, optionIndex) => <label key={`${option}-${optionIndex}`}><input name={field.id} type="radio" value={option} required={Boolean(field.required)} disabled={editorMode}/><span>{option}</span></label>)}</fieldset>
            : field.type === "checkbox" ? <label className="orvesen-form-checkbox"><input {...common} type="checkbox"/><span>{field.label}{field.required ? " *" : ""}</span></label>
            : <input {...common} type={field.type}/>}
        </div>;
      })}
    </div>

    <button type="submit" className="orvesen-form-submit" disabled={editorMode}>
      {document.settings?.submit_label || "Enviar"}
    </button>
  </form>;
}
