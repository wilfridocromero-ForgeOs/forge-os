import Sidebar from "./Sidebar";

export default function AppLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      <Sidebar />

      <main className="ml-72">
        {children}
      </main>
    </div>
  );
}