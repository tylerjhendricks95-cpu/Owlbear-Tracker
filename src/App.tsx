import React, { useEffect, useState } from "react";
import OBR, { Item } from "@owlbear-rodeo/sdk";
import { InitiativeEntry, InitiativeMetadata, METADATA_KEY } from "./types";

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [entries, setEntries] = useState<InitiativeEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  useEffect(() => {
    OBR.onReady(async () => {
      setIsReady(true);

      // Register context menu item on image tokens
      OBR.contextMenu.create({
        id: "com.tylerjhendricks95-cpu.initiative-tracker/add-token",
        icons: [
          {
            icon: "/icon.svg",
            label: "Add to Initiative",
            filter: {
              every: [{ property: "type", value: "IMAGE" }],
            },
          },
        ],
        async onClick(context) {
          await addTokensToTracker(context.items);
        },
      });

      // Listen for live updates from other players/GM
      OBR.room.onMetadataChange((metadata) => {
        const data = metadata[METADATA_KEY] as InitiativeMetadata | undefined;
        if (data) {
          setEntries(data.entries || []);
          setActiveIndex(data.activeIndex || 0);
        }
      });

      // Load initial room metadata state
      const initialMetadata = await OBR.room.getMetadata();
      const data = initialMetadata[METADATA_KEY] as InitiativeMetadata | undefined;
      if (data) {
        setEntries(data.entries || []);
        setActiveIndex(data.activeIndex || 0);
      }
    });
  }, []);

  const updateRoomState = async (newEntries: InitiativeEntry[], newActiveIndex: number) => {
    setEntries(newEntries);
    setActiveIndex(newActiveIndex);

    await OBR.room.setMetadata({
      [METADATA_KEY]: {
        entries: newEntries,
        activeIndex: newActiveIndex,
      },
    });

    if (newEntries.length > 0) {
      await highlightActiveToken(newEntries[newActiveIndex]?.id);
    } else {
      await highlightActiveToken(null);
    }
  };

  const addTokensToTracker = async (items: Item[]) => {
    const currentMetadata = (await OBR.room.getMetadata())[METADATA_KEY] as InitiativeMetadata | undefined;
    const existingEntries = currentMetadata?.entries || [];

    const newEntries: InitiativeEntry[] = [...existingEntries];

    for (const item of items) {
      if (newEntries.some((e) => e.id === item.id)) continue;

      const tokenName = item.name || "Token";
      const modInput = prompt(`Enter initiative modifier for "${tokenName}":`, "0");
      if (modInput === null) continue;

      const modifier = parseInt(modInput, 10) || 0;
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + modifier;

      newEntries.push({ id: item.id, name: tokenName, modifier, roll, total });
    }

    newEntries.sort((a, b) => b.total - a.total);
    await updateRoomState(newEntries, 0);
  };

  const highlightActiveToken = async (activeTokenId: string | null) => {
    const items = await OBR.scene.items.getItems();
    await OBR.scene.items.updateItems(items, (draft) => {
      for (const item of draft) {
        if (item.type === "IMAGE") {
          if (activeTokenId && item.id === activeTokenId) {
            item.outline = { color: "#FFD700", width: 8 };
          } else if (item.outline?.color === "#FFD700") {
            delete item.outline;
          }
        }
      }
    });
  };

  const nextTurn = async () => {
    if (entries.length === 0) return;
    const nextIdx = (activeIndex + 1) % entries.length;
    await updateRoomState(entries, nextIdx);
  };

  const prevTurn = async () => {
    if (entries.length === 0) return;
    const prevIdx = (activeIndex - 1 + entries.length) % entries.length;
    await updateRoomState(entries, prevIdx);
  };

  const removeEntry = async (id: string) => {
    const newEntries = entries.filter((e) => e.id !== id);
    let newIdx = activeIndex;
    if (newIdx >= newEntries.length) {
      newIdx = Math.max(0, newEntries.length - 1);
    }
    await updateRoomState(newEntries, newIdx);
  };

  const clearTracker = async () => {
    await updateRoomState([], 0);
  };

  if (!isReady) {
    return <div style={{ padding: 16, color: "#fff" }}>Connecting to Owlbear Rodeo...</div>;
  }

  return (
    <div style={{ padding: "12px", fontFamily: "sans-serif", color: "#fff", backgroundColor: "#1e1e24", height: "100vh", boxSizing: "border-box" }}>
      <h2 style={{ margin: "0 0 12px 0", fontSize: "18px", textAlign: "center" }}>Initiative Tracker</h2>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button style={{ flex: 1, padding: "6px", backgroundColor: "#3a3d4a", color: "#fff", border: "none", borderRadius: "4px" }} onClick={prevTurn} disabled={entries.length === 0}>◀ Prev</button>
        <button style={{ flex: 1, padding: "6px", backgroundColor: "#2e7d32", color: "#fff", border: "none", borderRadius: "4px", fontWeight: "bold" }} onClick={nextTurn} disabled={entries.length === 0}>Next ▶</button>
        <button style={{ padding: "6px", backgroundColor: "#c62828", color: "#fff", border: "none", borderRadius: "4px" }} onClick={clearTracker} disabled={entries.length === 0}>Clear</button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        {entries.map((entry, idx) => {
          const isActive = idx === activeIndex;
          return (
            <li key={entry.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", backgroundColor: isActive ? "#3e3b25" : "#2a2d37", borderRadius: "6px", borderLeft: isActive ? "4px solid #ffd700" : "4px solid transparent" }}>
              <div>
                <div style={{ fontWeight: "bold", fontSize: "14px" }}>{isActive && "⚔️ "}{entry.name}</div>
                <div style={{ fontSize: "11px", color: "#aaa" }}>(d20: {entry.roll} + {entry.modifier})</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px", fontWeight: "bold", color: "#ffd700" }}>{entry.total}</span>
                <button style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={() => removeEntry(entry.id)}>✕</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
