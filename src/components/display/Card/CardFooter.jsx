export default function CardFooter({
  children,
  className = "",
}) {
  return (
    <footer
      className={`mt-8 pt-6 border-t border-zinc-800 ${className}`}
    >
      {children}
    </footer>
  );
}