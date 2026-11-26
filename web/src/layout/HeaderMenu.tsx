/**
 * The header's menu on phones: one button that opens Theme, Mode and Log in/Log out as a menu
 * (WAI-ARIA menu button pattern). Wider screens show the same controls inline; CSS picks one.
 */
import { Check, LogIn, LogOut, Menu } from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useThemes } from "../api/queries";
import { t } from "../i18n";
import { setMode, setTheme, useAppearance, type Mode } from "../lib/theme";

export const MODES: readonly Mode[] = ["automatic", "light", "dark"];

interface Entry {
  readonly key: string;
  readonly label: string;
  /** A radio entry shows whether it is the chosen one; a plain entry runs a command. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly run: () => void;
}

interface Group {
  readonly label: string | null;
  readonly entries: readonly Entry[];
}

/** The menu's groups: Theme (when more than one is installed), Mode, then the account. */
function useGroups(account: readonly Entry[]): Group[] {
  const themes = useThemes();
  const { theme, mode, fixed } = useAppearance();
  const list = themes.data ?? [];
  const chosen = list.find((candidate) => candidate.id === theme) ?? list[0];
  const groups: Group[] = [];
  if (list.length > 1) {
    groups.push({
      label: t.shell.theme,
      entries: list.map((candidate) => ({
        key: `theme-${candidate.id}`,
        label: candidate.name,
        checked: candidate.id === chosen?.id,
        run: () => {
          setTheme(candidate.id);
        },
      })),
    });
  }
  groups.push({
    label: t.shell.mode,
    entries: MODES.map((value) => ({
      key: `mode-${value}`,
      label: t.shell.modes[value],
      checked: (fixed ?? mode) === value,
      disabled: fixed !== null,
      run: () => {
        setMode(value);
      },
    })),
  });
  if (account.length > 0) {
    groups.push({ label: null, entries: account });
  }
  return groups;
}

/** Where a key moves the focus among `count` entries from `index`, or null for other keys. */
function nextIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function HeaderMenu(props: {
  readonly onLogIn: (() => void) | null;
  readonly onLogOut: (() => void) | null;
}): ReactNode {
  const account: Entry[] = [];
  if (props.onLogIn !== null) {
    const run = props.onLogIn;
    account.push({ key: "log-in", label: t.shell.logIn, icon: <LogIn size={16} />, run });
  }
  if (props.onLogOut !== null) {
    const run = props.onLogOut;
    account.push({ key: "log-out", label: t.shell.logOut, icon: <LogOut size={16} />, run });
  }
  const groups = useGroups(account);
  const [open, setOpen] = useState(false);
  // Which entry gets the focus when the menu opens (first, or last after ArrowUp).
  const [start, setStart] = useState<"first" | "last">("first");
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = (): HTMLElement[] =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);

  useEffect(() => {
    if (!open) return undefined;
    const all = items();
    (start === "first" ? all[0] : all[all.length - 1])?.focus();
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) !== true && button.current?.contains(target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, start]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setStart(event.key === "ArrowDown" ? "first" : "last");
      setOpen(true);
    }
  };

  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const all = items();
    const next = nextIndex(
      event.key,
      all.indexOf(document.activeElement as HTMLElement),
      all.length,
    );
    if (next !== null) {
      event.preventDefault();
      all[next]?.focus();
    }
  };

  return (
    <div className="header-menu">
      <button
        ref={button}
        type="button"
        className="header-menu-button"
        aria-label={t.shell.menu}
        title={t.shell.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { "aria-controls": id } : {})}
        onClick={() => {
          setStart("first");
          setOpen((was) => !was);
        }}
        onKeyDown={onButtonKey}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={t.shell.menu}
          className="header-menu-list glass-panel"
          onKeyDown={onMenuKey}
        >
          {groups.map((group, index) => (
            <Fragment key={group.label ?? "account"}>
              {index > 0 ? <div role="separator" className="header-menu-separator" /> : null}
              <div role="group" {...(group.label === null ? {} : { "aria-label": group.label })}>
                {group.label === null ? null : (
                  <div className="header-menu-heading" aria-hidden="true">
                    {group.label}
                  </div>
                )}
                {group.entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    tabIndex={-1}
                    className="header-menu-item"
                    role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
                    {...(entry.checked === undefined ? {} : { "aria-checked": entry.checked })}
                    {...(entry.disabled === true ? { "aria-disabled": true } : {})}
                    onClick={() => {
                      if (entry.disabled === true) return;
                      entry.run();
                      close();
                    }}
                  >
                    <span className="header-menu-mark" aria-hidden="true">
                      {entry.checked === true ? <Check size={16} /> : (entry.icon ?? null)}
                    </span>
                    {entry.label}
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
