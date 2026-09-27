"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BINDER_COLORS } from "@tcg-vault/db/src/binder-options";
import type {
  AvailableCard,
  BinderDetail,
  Pocket as PocketData,
  PocketCard,
} from "@tcg-vault/db/src/binder-types";
import { mediaUrl } from "@tcg-vault/shared/src/media-url";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  FilePlus2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings2,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type MouseEvent,
} from "react";
import {
  addPagesAction,
  deleteBinderAction,
  movePocketAction,
  placeCardAction,
  removeFromPocketAction,
  searchVariantsAction,
  setWantAction,
  trimPagesAction,
  updateBinderAction,
  type ActionResult,
} from "../../app/binders/actions";
import { CardInspector } from "../card-viewer";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { BinderSpread, spreadCount, type SpreadHandle } from "./binder-spread";

const eur = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(minor / 100);

type DragData =
  | { type: "item"; card: AvailableCard }
  | { type: "pocket"; page: number; position: number; pocket: PocketData | undefined };

/** Immutable update of one pocket in the pages array. */
function withPocket(
  pages: PocketData[][],
  page: number,
  position: number,
  fn: (p: PocketData) => PocketData | null,
): PocketData[][] {
  return pages.map((pockets, i) => {
    if (i !== page) return pockets;
    const current = pockets.find((p) => p.position === position) ?? {
      position,
      item: null,
      want: null,
    };
    const next = fn(current);
    const rest = pockets.filter((p) => p.position !== position);
    return next && (next.item || next.want) ? [...rest, next] : rest;
  });
}

export function BinderView({
  binder,
  available: availableProp,
}: {
  binder: BinderDetail;
  available: AvailableCard[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [pages, setPages] = useState(binder.pages);
  const [available, setAvailable] = useState(availableProp);
  const [spread, setSpread] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; page: number; position: number } | null>(
    null,
  );
  const [inspect, setInspect] = useState<{ card: PocketCard; origin: DOMRect } | null>(null);
  const [wantFor, setWantFor] = useState<{ page: number; position: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const spreadHandle = useRef<SpreadHandle>(null);
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fresh server data (after router.refresh) replaces the optimistic copy.
  useEffect(() => setPages(binder.pages), [binder.pages]);
  useEffect(() => setAvailable(availableProp), [availableProp]);

  const total = spreadCount(pages.length);
  useEffect(() => {
    if (spread > total - 1) setSpread(Math.max(0, total - 1));
  }, [spread, total]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /** Run a server action; on failure show why and reload the real state. */
  const commit = useCallback(
    (action: () => Promise<ActionResult<unknown>>, success?: string) => {
      startTransition(async () => {
        const res = await action();
        if (!res.ok) toast("error", res.error);
        else if (success) toast("success", success);
        router.refresh();
      });
    },
    [router, toast],
  );

  const pocketAt = (page: number, position: number) =>
    pages[page]?.find((p) => p.position === position);

  // ---- optimistic operations -------------------------------------------------

  const returnToDrawer = (item: NonNullable<PocketData["item"]>) =>
    setAvailable((list) => {
      const found = list.find((c) => c.collectionItemId === item.collectionItemId);
      if (found) {
        return list.map((c) =>
          c.collectionItemId === item.collectionItemId ? { ...c, available: c.available + 1 } : c,
        );
      }
      return [{ ...item, available: 1 }, ...list];
    });

  const place = (card: AvailableCard, page: number, position: number) => {
    const displaced = pocketAt(page, position)?.item;
    setPages((p) =>
      withPocket(p, page, position, (cur) => ({
        ...cur,
        item: {
          ...card,
          collectionItemId: card.collectionItemId,
          condition: card.condition,
        },
      })),
    );
    setAvailable((list) =>
      list
        .map((c) =>
          c.collectionItemId === card.collectionItemId ? { ...c, available: c.available - 1 } : c,
        )
        .filter((c) => c.available > 0),
    );
    if (displaced) returnToDrawer(displaced);
    commit(() => placeCardAction(binder.id, page, position, card.collectionItemId));
  };

  const move = (
    from: { page: number; position: number },
    to: { page: number; position: number },
  ) => {
    if (from.page === to.page && from.position === to.position) return;
    const a = pocketAt(from.page, from.position);
    const b = pocketAt(to.page, to.position);
    setPages((p) => {
      let next = withPocket(p, from.page, from.position, () =>
        b ? { ...b, position: from.position } : null,
      );
      next = withPocket(next, to.page, to.position, () =>
        a ? { ...a, position: to.position } : null,
      );
      return next;
    });
    commit(() =>
      movePocketAction(
        binder.id,
        { pageIndex: from.page, position: from.position },
        { pageIndex: to.page, position: to.position },
      ),
    );
  };

  const remove = (page: number, position: number) => {
    const pocket = pocketAt(page, position);
    if (!pocket?.item) return;
    const item = pocket.item;
    setPages((p) => withPocket(p, page, position, (cur) => ({ ...cur, item: null })));
    returnToDrawer(item);
    commit(
      () => removeFromPocketAction(binder.id, page, position),
      `${item.name} is back in “Your cards”`,
    );
  };

  const clearWant = (page: number, position: number) => {
    setPages((p) => withPocket(p, page, position, (cur) => ({ ...cur, want: null })));
    commit(() => setWantAction(binder.id, page, position, null));
  };

  // ---- drag & drop -------------------------------------------------------------

  const onDragStart = (e: DragStartEvent) => {
    setMenu(null);
    setDragging(e.active.data.current as DragData);
  };
  const clearEdge = () => {
    if (edgeTimer.current) clearTimeout(edgeTimer.current);
    edgeTimer.current = null;
  };
  // Hold a card at the edge of the binder to turn the page, like a real one.
  const onDragOver = (e: DragOverEvent) => {
    const id = e.over?.id;
    if (id === "edge:left" || id === "edge:right") {
      if (edgeTimer.current) return;
      edgeTimer.current = setTimeout(() => {
        edgeTimer.current = null;
        spreadHandle.current?.turn(id === "edge:right" ? 1 : -1);
      }, 650);
    } else {
      clearEdge();
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    clearEdge();
    setDragging(null);
    const src = e.active.data.current as DragData | undefined;
    const over = e.over?.data.current as
      { type: string; page?: number; position?: number } | undefined;
    if (!src || !over) return;
    if (over.type === "pocket" && over.page !== undefined && over.position !== undefined) {
      if (src.type === "item") place(src.card, over.page, over.position);
      else
        move(
          { page: src.page, position: src.position },
          { page: over.page, position: over.position },
        );
    } else if (over.type === "drawer" && src.type === "pocket") {
      if (src.pocket?.item) remove(src.page, src.position);
      else if (src.pocket?.want) clearWant(src.page, src.position);
    }
  };

  // ---- pocket interactions -------------------------------------------------------

  const openPocket = (e: MouseEvent<HTMLElement>, page: number, position: number) => {
    const pocket = pocketAt(page, position);
    const card = pocket?.item ?? pocket?.want;
    if (card) setInspect({ card, origin: e.currentTarget.getBoundingClientRect() });
  };
  const pocketMenu = (e: MouseEvent<HTMLElement>, page: number, position: number) =>
    setMenu({ x: e.clientX, y: e.clientY, page, position });

  // Keyboard: arrows turn pages (not while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "ArrowRight") spreadHandle.current?.turn(1);
      if (e.key === "ArrowLeft") spreadHandle.current?.turn(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- derived stats -------------------------------------------------------------------

  const stats = useMemo(() => {
    const all = pages.flat();
    const owned = all.filter((p) => p.item);
    const wants = all.filter((p) => p.want);
    return {
      cards: owned.length,
      pockets: pages.length * binder.rows * binder.cols,
      value: owned.reduce((s, p) => s + (p.item?.valueEur ?? 0), 0),
      wants: wants.length,
      wantsFilled: wants.filter((p) => p.item).length,
      missingValue: wants.filter((p) => !p.item).reduce((s, p) => s + (p.want?.valueEur ?? 0), 0),
    };
  }, [pages, binder.rows, binder.cols]);

  const leftPage = 2 * spread - 1;
  const rightPage = 2 * spread;
  const pageLabel =
    spread === 0
      ? `Page 1 of ${pages.length}`
      : rightPage >= pages.length
        ? `Page ${leftPage + 1} of ${pages.length}`
        : `Pages ${leftPage + 1}–${rightPage + 1} of ${pages.length}`;

  const menuPocket = menu ? pocketAt(menu.page, menu.position) : undefined;

  return (
    <DndContext
      sensors={sensors}
      // The pocket under the cursor, not the one the floating preview overlaps most.
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        clearEdge();
        setDragging(null);
      }}
    >
      <div className="flex min-h-screen">
        <main className="binder-stage min-w-0 flex-1 px-8 pb-10 pt-7">
          {/* Header */}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Link
                href="/binders"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-accent hover:underline"
              >
                ← Binders
              </Link>
              <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
                {binder.name}
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                {stats.cards} / {stats.pockets} pockets filled ·{" "}
                <span className="font-medium text-neutral-800">{eur(stats.value)}</span>
                {stats.wants > 0 ? (
                  <>
                    {" "}
                    · {Math.round((stats.wantsFilled / stats.wants) * 100)}% of wanted cards
                    {stats.missingValue > 0 ? ` · ${eur(stats.missingValue)} to complete` : ""}
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => commit(() => addPagesAction(binder.id), "Added 2 pages")}
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Add pages
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="h-3.5 w-3.5" /> Binder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerOpen((o) => !o)}
                aria-label={drawerOpen ? "Hide your cards" : "Show your cards"}
                title={drawerOpen ? "Hide your cards" : "Show your cards"}
              >
                {drawerOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* The open binder */}
          <div className="binder-open" style={{ "--binder-color": binder.color } as CSSProperties}>
            <EdgeZone side="left" active={Boolean(dragging) && spread > 0} />
            <BinderSpread
              ref={spreadHandle}
              pages={pages}
              rows={binder.rows}
              cols={binder.cols}
              spread={spread}
              onSpreadChange={setSpread}
              onOpenPocket={openPocket}
              onPocketMenu={pocketMenu}
              frontCover={
                <div className="binder-front-cover">
                  <div className="binder-book__stitch" aria-hidden />
                  <span className="binder-front-cover__plate text-foil">{binder.name}</span>
                </div>
              }
              insideFront={
                <div className="binder-inside-cover">
                  <span className="binder-inside-cover__label">
                    <span className="font-display text-lg text-foil">{binder.name}</span>
                    {binder.setName && binder.setName !== binder.name ? (
                      <span className="mt-1 block text-xs opacity-70">{binder.setName}</span>
                    ) : null}
                    <span className="mt-3 block text-[11px] uppercase tracking-[0.2em] opacity-60">
                      {stats.cards} cards · {eur(stats.value)}
                    </span>
                  </span>
                </div>
              }
              insideBack={<div className="binder-inside-cover" />}
            />
            <EdgeZone side="right" active={Boolean(dragging) && spread < total - 1} />
          </div>

          {/* Page navigation */}
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => spreadHandle.current?.turn(-1)}
              disabled={spread === 0}
              aria-label="Previous pages"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="range"
              min={0}
              max={total - 1}
              value={spread}
              onChange={(e) => setSpread(Number(e.target.value))}
              aria-label="Jump to page"
              className="w-48 accent-[rgb(var(--accent))]"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => spreadHandle.current?.turn(1)}
              disabled={spread >= total - 1}
              aria-label="Next pages"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="w-40 text-xs tabular-nums text-neutral-500">{pageLabel}</span>
          </div>
          <p className="mt-2 text-center text-[11px] text-neutral-400">
            Drag cards in from “Your cards” · drag between pockets to move or swap · drag a page
            corner (or ← →) to turn · right-click a pocket for more
          </p>
        </main>

        {drawerOpen ? <Drawer cards={available} dragging={Boolean(dragging)} /> : null}
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
        {dragging ? <DragPreview data={dragging} /> : null}
      </DragOverlay>

      {menu ? (
        <PocketMenu
          x={menu.x}
          y={menu.y}
          pocket={menuPocket}
          onClose={() => setMenu(null)}
          onInspect={() => {
            const card = menuPocket?.item ?? menuPocket?.want;
            if (card) {
              setInspect({
                card,
                origin: new DOMRect(menu.x - 40, menu.y - 56, 80, 112),
              });
            }
          }}
          onRemove={() => remove(menu.page, menu.position)}
          onWant={() => setWantFor({ page: menu.page, position: menu.position })}
          onClearWant={() => clearWant(menu.page, menu.position)}
        />
      ) : null}

      {inspect ? (
        <CardInspector
          imageSrc={inspect.card.imageKey ? mediaUrl(inspect.card.imageKey) : null}
          name={inspect.card.name}
          number={inspect.card.number}
          rarityName={inspect.card.rarity}
          finishes={[inspect.card.finish]}
          finish={inspect.card.finish}
          onFinishChange={() => {}}
          origin={inspect.origin}
          onClose={() => setInspect(null)}
        />
      ) : null}

      <WantDialog
        open={wantFor !== null}
        onClose={() => setWantFor(null)}
        onPick={(variant) => {
          if (!wantFor) return;
          const { page, position } = wantFor;
          setPages((p) => withPocket(p, page, position, (cur) => ({ ...cur, want: variant })));
          commit(
            () => setWantAction(binder.id, page, position, variant.variantId),
            `Pocket is now for ${variant.name}`,
          );
          setWantFor(null);
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        binder={binder}
        onSave={(data) => commit(() => updateBinderAction(binder.id, data), "Binder updated")}
        onTrim={() => commit(() => trimPagesAction(binder.id), "Removed empty pages at the end")}
        onDelete={() =>
          startTransition(async () => {
            const res = await deleteBinderAction(binder.id);
            if (!res.ok) return toast("error", res.error);
            toast("success", `Deleted “${binder.name}” — its cards are still in your collection`);
            router.push("/binders");
          })
        }
      />
    </DndContext>
  );
}

/** Invisible strip at the binder's edge: hold a dragged card here to turn the page. */
function EdgeZone({ side, active }: { side: "left" | "right"; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `edge:${side}`,
    data: { type: "edge" },
    disabled: !active,
  });
  return (
    <div
      ref={setNodeRef}
      className={`binder-edge binder-edge--${side} ${active ? "binder-edge--active" : ""} ${
        isOver ? "binder-edge--over" : ""
      }`}
      aria-hidden
    />
  );
}

function Drawer({ cards, dragging }: { cards: AvailableCard[]; dragging: boolean }) {
  const [query, setQuery] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: "drawer", data: { type: "drawer" } });
  const q = query.trim().toLowerCase();
  const shown = cards.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.setName.toLowerCase().includes(q),
  );
  return (
    <aside
      ref={setNodeRef}
      className={`sticky top-0 flex h-screen w-72 shrink-0 flex-col border-l bg-sidebar transition-colors ${
        isOver ? "bg-accent-soft" : ""
      }`}
    >
      <div className="border-b p-4">
        <p className="text-sm font-semibold">
          Your cards <span className="font-normal text-neutral-500">({cards.length})</span>
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {dragging ? "Drop here to take a card out" : "Not in any binder yet — drag into a pocket"}
        </p>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            className="field w-full pl-8"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter your cards"
          />
        </label>
      </div>
      {cards.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">
          Every card you own is already in a binder.{" "}
          <Link href="/browse" className="text-accent underline">
            Add more to your collection
          </Link>
          .
        </p>
      ) : (
        <ul className="grid flex-1 auto-rows-min grid-cols-3 gap-2.5 overflow-y-auto p-4">
          {shown.map((c) => (
            <DrawerCard key={c.collectionItemId} card={c} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function DrawerCard({ card }: { card: AvailableCard }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `item:${card.collectionItemId}`,
    data: { type: "item", card },
  });
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        className={`group relative block w-full cursor-grab touch-none rounded-md transition-opacity active:cursor-grabbing ${
          isDragging ? "opacity-30" : ""
        }`}
        title={`${card.name} · ${card.number}${card.valueEur ? ` · ${eur(card.valueEur)}` : ""}`}
        aria-label={`${card.name} ${card.number}, drag into a pocket`}
      >
        <MiniCard card={card} />
        {card.available > 1 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-fg shadow">
            ×{card.available}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function MiniCard({ card, lifted = false }: { card: PocketCard; lifted?: boolean }) {
  return card.imageKey ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaUrl(card.imageKey)}
      alt={card.name}
      draggable={false}
      className={`aspect-[5/7] w-full rounded-md object-cover shadow-sm ${lifted ? "shadow-2xl" : ""}`}
    />
  ) : (
    <div className="grid aspect-[5/7] w-full place-items-center rounded-md border-2 border-amber-200 bg-surface-2 p-1 text-center text-[9px] leading-tight text-neutral-600 dark:border-amber-900">
      {card.name}
    </div>
  );
}

function DragPreview({ data }: { data: DragData }) {
  const card = data.type === "item" ? data.card : (data.pocket?.item ?? data.pocket?.want);
  if (!card) return null;
  return (
    <div className="w-24 rotate-3 scale-105 cursor-grabbing drop-shadow-2xl">
      <MiniCard card={card} lifted />
    </div>
  );
}

function PocketMenu({
  x,
  y,
  pocket,
  onClose,
  onInspect,
  onRemove,
  onWant,
  onClearWant,
}: {
  x: number;
  y: number;
  pocket: PocketData | undefined;
  onClose: () => void;
  onInspect: () => void;
  onRemove: () => void;
  onWant: () => void;
  onClearWant: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);
  const card = pocket?.item ?? pocket?.want;
  const item = (icon: React.ReactNode, label: string, act: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        act();
        onClose();
      }}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 ${
        danger ? "text-red-600 dark:text-red-400" : ""
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      role="menu"
      className="panel fixed z-50 w-56 p-1.5"
      style={{
        left: Math.min(x, window.innerWidth - 240),
        top: Math.min(y, window.innerHeight - 220),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {card ? (
        <p className="truncate px-2.5 pb-1.5 pt-1 text-xs text-neutral-500">
          {card.name} · {card.number}
        </p>
      ) : null}
      {card ? item(<Eye className="h-4 w-4" />, "Inspect", onInspect) : null}
      {card ? (
        <Link
          href={card.href}
          role="menuitem"
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2"
        >
          <ExternalLink className="h-4 w-4" /> Open card page
        </Link>
      ) : null}
      {pocket?.item ? item(<Undo2 className="h-4 w-4" />, "Take out of binder", onRemove) : null}
      {item(
        <Star className="h-4 w-4" />,
        pocket?.want ? "Change wanted card…" : "Mark as wanted…",
        onWant,
      )}
      {pocket?.want
        ? item(<Trash2 className="h-4 w-4" />, "Clear wanted card", onClearWant, true)
        : null}
    </div>
  );
}

function WantDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: PocketCard & { variantId: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<PocketCard & { variantId: string }>>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setResults(await searchVariantsAction(query)), 200);
    return () => clearTimeout(t);
  }, [query, open]);
  return (
    <Dialog open={open} onClose={onClose} title="Which card is this pocket for?" width="max-w-2xl">
      <input
        className="field w-full"
        placeholder="Search by card name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="mt-4 grid max-h-[55vh] grid-cols-4 gap-3 overflow-y-auto sm:grid-cols-6">
        {results.map((r) => (
          <li key={r.variantId}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="card-tile block w-full rounded-md text-left"
              title={`${r.name} · ${r.setName} ${r.number} · ${r.finish}`}
            >
              <MiniCard card={r} />
              <span className="mt-1 block truncate text-[10px] text-neutral-500">
                {r.setName} ·{" "}
                {r.finish === "NON_FOIL" ? "Normal" : r.finish.replace("_", " ").toLowerCase()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {query && results.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">No cards found — is the set synced?</p>
      ) : null}
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onClose,
  binder,
  onSave,
  onTrim,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  binder: BinderDetail;
  onSave: (data: { name: string; color: string }) => void;
  onTrim: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(binder.name);
  const [color, setColor] = useState(binder.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (open) {
      setName(binder.name);
      setColor(binder.color);
      setConfirmDelete(false);
    }
  }, [open, binder.name, binder.color]);
  return (
    <Dialog open={open} onClose={onClose} title="Binder settings">
      <div className="flex flex-col gap-4">
        <label className="label">
          Name
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </label>
        <div className="label">
          Cover
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cover colour">
            {BINDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  color === c ? "border-accent ring-2 ring-accent/40" : "border-transparent"
                }`}
                style={{ background: `radial-gradient(circle at 35% 30%, ${c}cc, ${c})` }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave({ name, color });
              onClose();
            }}
          >
            Save
          </Button>
        </div>
        <hr className="border-neutral-200" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onTrim();
              onClose();
            }}
          >
            Remove empty pages at the end
          </Button>
          {confirmDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Yes, delete “{binder.name}”
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete binder
            </Button>
          )}
        </div>
        {confirmDelete ? (
          <p className="text-xs text-neutral-500">
            The binder and its page layout go away; the cards stay in your collection.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
