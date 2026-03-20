import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type CommandPaletteItem,
  filterCommandPaletteItems,
} from "../command-palette";
import { Modal } from "./Modal";

interface CommandPaletteProps {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
  onSelect: (item: CommandPaletteItem) => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filteredItems = useMemo(
    () => filterCommandPaletteItems(props.items, query).slice(0, 24),
    [props.items, query]
  );

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [props.open]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((current) =>
      current < 0 || current >= filteredItems.length ? 0 : current
    );
  }, [filteredItems.length]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((current) => (current + 1) % filteredItems.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex(
          (current) =>
            (current - 1 + filteredItems.length) % filteredItems.length
        );
      }
      return;
    }

    if (event.key === "Enter") {
      const activeItem = filteredItems[activeIndex];
      if (!activeItem) {
        return;
      }

      event.preventDefault();
      props.onSelect(activeItem);
    }
  }

  return (
    <Modal
      open={props.open}
      title="Command palette"
      description="Switch agents, jump between chats, or run a quick action."
      className="command-palette-modal"
      onClose={props.onClose}
    >
      <label className="field-group">
        <span className="sr-only">Search commands</span>
        <input
          data-autofocus="true"
          type="search"
          className="palette-search"
          placeholder="Search agents, chats, or actions..."
          aria-label="Search commands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
      </label>

      <div className="palette-list" role="listbox" aria-label="Command results">
        {filteredItems.length === 0 ? (
          <div className="empty-panel compact">
            No matching agents, chats, or actions.
          </div>
        ) : (
          filteredItems.map((item, index) => {
            const showGroupHeading =
              filteredItems[index - 1]?.group !== item.group;
            return (
              <Fragment key={item.id}>
                {showGroupHeading ? (
                  <div className="palette-group-heading">{item.group}</div>
                ) : null}
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? "palette-item active"
                      : "palette-item"
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => props.onSelect(item)}
                >
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </div>
                  <span className="scope-chip">{item.kind}</span>
                </button>
              </Fragment>
            );
          })
        )}
      </div>

      <div className="palette-footer">
        <span>Arrow keys move, Enter selects, Esc closes.</span>
        <span>Cmd/Ctrl+K opens this palette.</span>
      </div>
    </Modal>
  );
}
