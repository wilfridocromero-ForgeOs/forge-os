import {
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardPenLine,
  FolderKanban,
  LayoutDashboard,
  Settings,
  Sparkles,
  SlidersHorizontal,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { CAPABILITIES } from "./capabilities";

export const navigationGroups = [
  {
    title: "GENERAL",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, to: "/" },
      { label: "ORVESEN IA", icon: Sparkles, to: "/orvesen-ia" },
      { label: "Clientes", icon: Users, to: "/clientes" },
      { label: "Discovery", icon: Brain, to: "/discovery", end: true },
      { label: "Cerebro", icon: BookOpen, to: "/cerebro" },
      {
        label: "ORVESEN Score",
        icon: BarChart3,
        to: "/orvesen-score",
        moduleKey: "area_score",
        organization: "internal",
      },
      {
        label: "Business Score",
        icon: BarChart3,
        to: "/business-score",
        organization: "external",
      },
    ],
  },
  {
    title: "OPERAR",
    items: [
      { label: "Proyectos", icon: FolderKanban, to: "/proyectos", moduleKey: "projects" },
      { label: "Calendario", icon: CalendarDays, to: "/calendario" },
    ],
  },
  {
    title: "SISTEMA",
    items: [
      {
        label: "Construir",
        icon: Wrench,
        to: "/construir",
        capability: CAPABILITIES.accessBuilderHub,
        activePaths: ["/score-builder", "/discovery/builder"],
      },
      { label: "Configuración", icon: Settings, to: "/configuracion" },
    ],
  },
];

export const quickCreateItems = [
  { label: "Nuevo diagnóstico", to: "/discovery?new=1", icon: ClipboardCheck },
  { label: "Nuevo cliente", to: "/clientes?new=1", icon: Users },
  { label: "Nuevo proyecto", to: "/proyectos?new=1", icon: FolderKanban },
  { label: "Nuevo evento", to: "/calendario?new=1", icon: CalendarDays },
];

export const settingsSections = [
  {
    group: "PERSONAL",
    items: [
      {
        label: "Mi cuenta",
        description: "Tu nombre, perfil y preferencias personales.",
        to: "/configuracion/cuenta",
        icon: UserRound,
      },
    ],
  },
  {
    group: "ORGANIZACIÓN",
    items: [
      {
        label: "Empresa",
        description: "Información actual de la organización activa.",
        to: "/configuracion/empresa",
        icon: Building2,
        capability: CAPABILITIES.manageOrganization,
      },
      {
        label: "Miembros",
        description: "Personas, invitaciones, roles y accesos.",
        to: "/configuracion/miembros",
        icon: Users,
        capability: CAPABILITIES.manageMembers,
      },
      {
        label: "Divisiones",
        description: "Estructura activa de áreas y divisiones.",
        to: "/configuracion/divisiones",
        icon: SlidersHorizontal,
        capability: CAPABILITIES.manageDivisions,
      },
    ],
  },
];

export const builderEntries = [
  {
    label: "Score Builder",
    description: "Diseña Scores, categorías, preguntas y reglas de evaluación.",
    to: "/score-builder",
    icon: SlidersHorizontal,
  },
  {
    label: "Discovery Builder",
    description: "Construye y publica procesos Discovery conectados al Score.",
    to: "/discovery/builder",
    icon: ClipboardPenLine,
  },
];
