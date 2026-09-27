import Link from "next/link";

const LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/search", label: "Search" },
  { href: "/collection", label: "Collection" },
  { href: "/binders", label: "Binders" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sync", label: "Sync" },
];

export function NavBar() {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
        <Link href="/" className="font-semibold">
          TCG Vault
        </Link>
        <nav className="flex gap-4 text-sm text-neutral-600">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-neutral-950">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
