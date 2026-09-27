/** Re-mounted on every navigation: gives each page a short fade/rise in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
