import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import ProfileModal from "../components/Layout/ProfileModal";
import { useAuth } from "../Context/AuthContext";
import { CAPABILITIES } from "../config/capabilities";
import { settingsSections } from "../config/navigation";
import MembersSettings from "./settings/MembersSettings";
import DivisionAdministration from "./settings/DivisionsSettings";

const ORGANIZATION_TYPE_LABELS = {
  internal: "Organización interna",
  business: "Empresa",
  client: "Cliente",
  legacy: "Organización heredada",
  pending: "Pendiente de clasificación",
};

export default function SettingsHub() {
  const { hasCapability } = useAuth();

  return (
    <Page className="space-y-7">
      <SettingsHeader title="Centro de Configuración" description="Administra tu cuenta y, según tu rol, la organización activa." hub />
      <div className="space-y-7">
        {settingsSections.map((section) => {
          const items = section.items.filter((item) => !item.capability || hasCapability(item.capability));
          if (!items.length) return null;
          return (
            <section key={section.group} className="space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{section.group}</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map(({ label, description, to, icon: Icon }) => (
                  <Link key={to} to={to} className="block min-w-0">
                    <Card hover contentClassName="flex h-full min-w-0 items-start gap-4 p-5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900"><Icon size={19} /></span>
                      <div className="min-w-0 flex-1"><h2 className="font-semibold text-white">{label}</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p></div>
                      <ArrowRight className="mt-1 shrink-0 text-zinc-500" size={17} />
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}

export function AccountSettings() {
  const { displayName, roleLabel, jobTitle, user, organization } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <SettingsSectionLayout title="Mi cuenta" description="Tu perfil personal y la información asociada a la sesión.">
      <div className="space-y-5">
        <Card hover={false} contentClassName="p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Editable</p>
          <SettingValue label="Nombre visible" value={displayName} className="mt-5" />
          <button onClick={() => setProfileOpen(true)} className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-medium text-black sm:w-auto">Editar nombre visible</button>
        </Card>
        <Card hover={false} contentClassName="p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Información de la cuenta</p>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <SettingValue label="Correo" value={user?.email} />
            <SettingValue label="Rol" value={roleLabel} />
            <SettingValue label="Cargo" value={jobTitle || "Sin cargo asignado"} />
            <SettingValue label="Organización" value={organization?.name} />
          </dl>
        </Card>
      </div>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </SettingsSectionLayout>
  );
}

export function CompanySettings() {
  const { organization, hasCapability, updateOrganizationName } = useAuth();
  const canEdit = hasCapability(CAPABILITIES.updateOrganizationProfile);
  const [name, setName] = useState(organization?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedName = name.trim();

  async function saveCompany(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await updateOrganizationName(normalizedName);
      setMessage("Nombre de la organización actualizado.");
    } catch (error) {
      setMessage(error.message || "No se pudo actualizar la organización.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSectionLayout title="Empresa" description="Información y configuración disponible de la organización activa.">
      <Card hover={false} contentClassName="p-5 sm:p-6">
        <form onSubmit={saveCompany}>
          <label className="block max-w-xl">
            <span className="mb-2 block text-sm text-zinc-400">Nombre de la organización</span>
            {canEdit ? (
              <input className="field" value={name} onChange={(event) => { setName(event.target.value); setMessage(""); }} minLength={2} maxLength={120} required />
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-white">{organization?.name || "No disponible"}</div>
            )}
          </label>
          {canEdit ? (
            <button disabled={saving || normalizedName.length < 2 || normalizedName === organization?.name} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"><Save size={17} /> {saving ? "Guardando..." : "Guardar nombre"}</button>
          ) : (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">Tu rol permite administrar la organización, pero el contrato administrativo actual reserva la edición de estos datos al fundador.</p>
          )}
          {message && <p className="mt-4 text-sm text-zinc-300" role="status">{message}</p>}
        </form>

        <div className="my-6 border-t border-zinc-800" />
        <dl className="grid gap-5 sm:grid-cols-2">
          <SettingValue label="Tipo de organización" value={ORGANIZATION_TYPE_LABELS[organization?.organization_type] || organization?.organization_type} />
          <SettingValue label="Identificador" value={organization?.id} />
          <SettingValue label="Creada" value={formatDate(organization?.created_at)} />
          <SettingValue label="Última actualización" value={formatDate(organization?.updated_at)} />
        </dl>
        <p className="mt-6 text-sm leading-6 text-zinc-500">El tipo de organización es informativo y no se modifica desde este panel.</p>
      </Card>
    </SettingsSectionLayout>
  );
}

export function DivisionsSettings() {
  return (
    <SettingsSectionLayout title="Divisiones" description="Crea, organiza y administra la disponibilidad de las divisiones.">
      <DivisionAdministration />
    </SettingsSectionLayout>
  );
}

export function MembersSettingsPage() {
  return (
    <SettingsSectionLayout title="Miembros" description="Personas, invitaciones, roles y accesos." hideHeading>
      <MembersSettings />
    </SettingsSectionLayout>
  );
}

function SettingsSectionLayout({ title, description, children, hideHeading = false }) {
  const { hasCapability } = useAuth();
  const visibleSections = settingsSections.flatMap((section) => section.items.filter((item) => !item.capability || hasCapability(item.capability)));

  return (
    <Page className="space-y-6">
      <Link to="/configuracion" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white lg:hidden"><ArrowLeft size={16} /> Volver a Configuración</Link>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Secciones de configuración" className="sticky top-8 space-y-1">
            {visibleSections.map(({ label, to, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${isActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"}`}><Icon size={17} /> {label}</NavLink>
            ))}
          </nav>
        </aside>
        <section className="min-w-0">
          {!hideHeading && <SettingsHeader title={title} description={description} />}
          <div className={hideHeading ? "min-w-0" : "mt-6 min-w-0"}>{children}</div>
        </section>
      </div>
    </Page>
  );
}

function SettingsHeader({ title, description, hub = false }) {
  return <header><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Configuración</p><h1 className="mt-2 text-3xl font-semibold text-white">{title}</h1><p className="mt-2 max-w-2xl text-zinc-400">{description}</p>{hub && <div className="mt-5 h-px bg-zinc-800" />}</header>;
}

function SettingValue({ label, value, className = "" }) {
  return <div className={`min-w-0 ${className}`}><dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</dt><dd className="mt-2 break-words text-white">{value || "No disponible"}</dd></div>;
}

function formatDate(value) {
  if (!value) return "No disponible";
  return new Intl.DateTimeFormat("es-BO", { dateStyle: "medium" }).format(new Date(value));
}
