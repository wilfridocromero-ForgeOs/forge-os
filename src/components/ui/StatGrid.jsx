export default function StatGrid({ children }) {
  return (
    <div className="grid grid-cols-4 gap-7">
      {children}
    </div>
  );
}