import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import Sidebar from "./Sidebar";
import Header from "./Header";
import { readBuilderWorkspacePreferences, writeBuilderWorkspacePreferences } from "../../features/builder/model/builderWorkspacePreferences";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const isBuilderWorkspace = /^\/construir\/(?:sistemas\/[^/]+|assets\/landing_page\/[^/]+)/.test(location.pathname);
  const [builderSidebarCollapsed, setBuilderSidebarCollapsed] = useState(
    () => readBuilderWorkspacePreferences().globalSidebarCollapsed,
  );

  function toggleBuilderSidebar() {
    const next = !builderSidebarCollapsed;
    writeBuilderWorkspacePreferences({ ...readBuilderWorkspacePreferences(), globalSidebarCollapsed: next });
    setBuilderSidebarCollapsed(next);
  }

  const sidebarCollapsed = isBuilderWorkspace && builderSidebarCollapsed;

  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        collapsed={sidebarCollapsed}
        collapsible={isBuilderWorkspace}
        onCollapsedChange={toggleBuilderSidebar}
      />

      <div className={`${sidebarCollapsed ? "lg:ml-[76px]" : "lg:ml-72"} min-h-screen flex flex-col transition-[margin] duration-200`}>
        <Header setSidebarOpen={setSidebarOpen} />

        <main className="app-content flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
