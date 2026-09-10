import React, { useEffect, useState } from "react";
import OBR, { Item } from "@owlbear-rodeo/sdk";

export interface TrackerEntry {
  id: string; // Token ID
  name: string;
  isAuto: boolean;
  modifier: number;
  score: number;
  hp: number;
  maxHp: number;
  conditions: string[]; // Active status tags
}

export interface RoomData {
  entries: TrackerEntry[];
  activeIndex: number;
  round: number;
  inCombat: boolean;
}

const METADATA_KEY = "com.tylerjhendricks95-cpu.initiative-tracker/metadata";
const HIGHLIGHT_ID = "initiative-tracker-active-highlight";

// Inline Data URL icon to prevent broken assets
const CONTEXT_ICON =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23FFD700'><path d='M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'/></svg>";

// Common preset conditions with custom color coding
const PRESET_CONDITIONS = [
  { name: "Poisoned", color: "#2e7d32" },
  { name: "Stunned", color: "#ed6c02" },
  { name: "Blessed", color: "#0288d1" },
  { name: "Prone", color: "#7b1fa2" },
  { name: "Frightened", color: "#c62828" },
];

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [round, setRound] = useState<number>(1);
  const [inCombat, setInCombat] = useState<boolean>(false);

  useEffect(() => {
    OBR.onReady(async () => {
      setIsReady(true);

      // 1. Clean up existing context menu item
      try {
        await OBR.contextMenu.remove("com.tylerjhendricks95-cpu.initiative-tracker/add-token");
      } catch (_) {}

      // 2. Register context menu option
      try {
        await OBR.contextMenu.create({
          id: "com.tylerjhendricks95-cpu.initiative-tracker/add-token",
          icons: [
            {
              icon: CONTEXT_ICON,
              label: "Add to Initiative",
            },
          ],
          select: [
            {
              items: [
                { property: "layer", value: "CHARACTER" },
                { property: "layer", value: "MOUNT" },
                { property: "type", value: "IMAGE" },
              ],
            },
          ],
          async onClick(context) {
            await addTokensToTracker(context.items);
          },
        });
      } catch (err) {
        console.error("Failed to register context menu:", err);
      }

      // 3. Listen for room metadata updates across clients
      OBR.room.onMetadataChange(async (metadata) => {
        const data = metadata[METADATA_KEY] as RoomData | undefined;
        if (data) {
          setEntries(data.entries || []);
          setActiveIndex(data.activeIndex || 0);
          setRound(data.round || 1);
          setInCombat(data.inCombat || false);

          if (data.inCombat && data.entries.length > 0) {
            const activeId = data.entries[data.activeIndex]?.id;
            await highlightActiveTokenOnMap(activeId || null);
          } else {
            await highlightActiveTokenOnMap(null);
          }
        }
      });

      // 4. Fetch initial room state on load
      const initial = await OBR.room.getMetadata();
      const data = initial[METADATA_KEY] as RoomData | undefined;
      if (data) {
        setEntries(data.entries || []);
        setActiveIndex(data.activeIndex || 0);
        setRound(data.round || 1);
        setInCombat(data.inCombat || false);

        if (data.inCombat && data.entries.length > 0) {
          const activeId = data.entries[data.activeIndex]?.id;
          await highlightActiveTokenOnMap(activeId || null);
        }
      }
    });
  }, []);

  // Attaches a visual ring to the active token without moving/panning the camera
  const highlightActiveTokenOnMap = async (activeTokenId: string | null) => {
    try {
      // Always remove previous highlight ring first
      const allItems = await OBR.scene.items.getItems();
      if (allItems.some((item) => item.id === HIGHLIGHT_ID)) {
        await OBR.scene.items.deleteItems([HIGHLIGHT_ID]);
      }

      if (!activeTokenId) return;

      const targetToken = allItems.find((item) => item.id === activeTokenId);
      if (!targetToken) return;

      // Calculate center position and sizing for the attachment ring
      const gridDpi = targetToken.grid?.dpi || 150;
      const width = gridDpi * (targetToken.scale?.x || 1);
      const height = gridDpi * (targetToken.scale?.y || 1);

      const ring = OBR.buildShape()
        .id(HIGHLIGHT_ID)
        .shapeType("CIRCLE")
        .position({
          x: targetToken.position.x + width / 2,
          y: targetToken.position.y + height / 2,
        })
        .radius(Math.max(30, width / 2 + 10))
        .fillColor("#FFD700")
        .fillOpacity(0.25)
        .strokeColor("#FFD700")
        .strokeWidth(5)
        .strokeOpacity(1)
        .layer("ATTACHMENT")
        .attachedTo(targetToken.id)
        .locked(true)
        .build();

      await OBR.scene.items.addItems([ring]);
    } catch (err) {
      console.error("Failed to update active token highlight:", err);
    }
  };

  // Save state to metadata and update map highlight
  const saveRoomState = async (
    newEntries: TrackerEntry[],
    newActiveIdx: number,
    newRound: number,
    newInCombat: boolean
  ) => {
    setEntries(newEntries);
    setActiveIndex(newActiveIdx);
    setRound(newRound);
    setInCombat(newInCombat);

    await OBR.room.setMetadata({
      [METADATA_KEY]: {
        entries: newEntries,
        activeIndex: newActiveIdx,
        round: newRound,
        inCombat: newInCombat,
      },
    });

    if (newInCombat && newEntries.length > 0) {
      await highlightActiveTokenOnMap(newEntries[newActiveIdx]?.id || null);
    } else {
      await highlightActiveTokenOnMap(null);
    }
  };

  const addTokensToTracker = async (items: Item[]) => {
    const currentMetadata = (await OBR.room.getMetadata())[METADATA_KEY] as RoomData | undefined;
    const existingEntries = currentMetadata?.entries || [];
    const newEntries = [...existingEntries];

    for (const item of items) {
      if (newEntries.some((e) => e.id === item.id)) continue;

      newEntries.push({
        id: item.id,
        name: item.name || "Token",
        isAuto: true,
        modifier: 0,
        score: 0,
        hp: 10,
        maxHp: 10,
        conditions: [],
      });
    }

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  const handleAddSelected = async () => {
    const selectedIds = await OBR.player.getSelection();
    if (!selectedIds || selectedIds.length === 0) return;

    const selectedItems = await OBR.scene.items.getItems(selectedIds);
    await addTokensToTracker(selectedItems);
  };

  const toggleAuto = async (id: string) => {
    const newEntries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      const nextIsAuto = !entry.isAuto;
      let newScore = entry.score;

      if (nextIsAuto && inCombat) {
        const roll = Math.floor(Math.random() * 20) + 1;
        newScore = roll + entry.modifier;
      }

      return { ...entry, isAuto: nextIsAuto, score: newScore };
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  const updateEntryValue = async (
    id: string,
    field: "score" | "modifier" | "hp" | "maxHp",
    val: number
  ) => {
    const newEntries = entries.map((e) => {
      if (e.id !== id) return e;
      if (field === "score") return { ...e, score: val };
      if (field === "modifier") return { ...e, modifier: val };
      if (field === "hp") return { ...e, hp: Math.min(e.maxHp, Math.max(0, val)) };
      if (field === "maxHp") {
        const newMax = Math.max(1, val);
        return {
          ...e,
          maxHp: newMax,
          hp: !inCombat ? newMax : Math.min(e.hp, newMax),
        };
      }
      return e;
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  const adjustHp = async (id: string, delta: number) => {
    const newEntries = entries.map((e) => {
      if (e.id !== id) return e;
      const newHp = Math.min(e.maxHp, Math.max(0, e.hp + delta));
      return { ...e, hp: newHp };
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  const toggleCondition = async (entryId: string, conditionName: string) => {
    const newEntries = entries.map((e) => {
      if (e.id !== entryId) return e;
      const current = e.conditions || [];
      const exists = current.includes(conditionName);
      const updated = exists
        ? current.filter((c) => c !== conditionName)
        : [...current, conditionName];
      return { ...e, conditions: updated };
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  const startCombat = async () => {
    if (entries.length === 0) return;

    const rolledEntries = entries.map((entry) => {
      if (entry.isAuto) {
        const roll = Math.floor(Math.random() * 20) + 1;
        return { ...entry, score: roll + entry.modifier };
      }
      return entry;
    });

    const sorted = [...rolledEntries].sort((a, b) => b.score - a.score);
    await saveRoomState(sorted, 0, 1, true);
  };

  const nextTurn = async () => {
    if (entries.length === 0) return;
    let nextIdx = activeIndex + 1;
    let nextRound = round;

    if (nextIdx >= entries.length) {
      nextIdx = 0;
      nextRound += 1;
    }

    await saveRoomState(entries, nextIdx, nextRound, true);
  };

  const endCombat = async () => {
    await saveRoomState(entries, 0, 1, false);
  };

  const removeEntry = async (id: string) => {
    const newEntries = entries.filter((e) => e.id !== id);
    let nextIdx = activeIndex;
    if (nextIdx >= newEntries.length) {
      nextIdx = Math.max(0, newEntries.length - 1);
    }
    await saveRoomState(newEntries, nextIdx, round, inCombat && newEntries.length > 0);
  };

  if (!isReady) {
    return <div style={{ padding: 16, color: "#fff" }}>Connecting to Owlbear Rodeo...</div>;
  }

  return (
    <div
      style={{
        padding: "12px",
        color: "#fff",
        backgroundColor: "#1e1e24",
        minHeight: "100vh",
        boxSizing: "border-box",
        fontFamily: "sans-serif",
      }}
    >
      <h2 style={{ margin: "0 0 8px 0", textAlign: "center", fontSize: "18px" }}>
        Initiative Tracker
      </h2>

      {/* Round & Combat Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#2a2d37",
          padding: "8px 12px",
          borderRadius: "6px",
          marginBottom: "8px",
        }}
      >
        <span style={{ fontWeight: "bold", fontSize: "14px", color: "#ffd700" }}>
          Round: {round}
        </span>
        {!inCombat ? (
          <button
            style={{
              padding: "6px 12px",
              backgroundColor: "#2e7d32",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
            onClick={startCombat}
            disabled={entries.length === 0}
          >
            ⚔️ Start Combat
          </button>
        ) : (
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              style={{
                padding: "6px 12px",
                backgroundColor: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
              onClick={nextTurn}
            >
              Next Turn ▶
            </button>
            <button
              style={{
                padding: "6px 8px",
                backgroundColor: "#c62828",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
              onClick={endCombat}
            >
              End
            </button>
          </div>
        )}
      </div>

      {/* Panel Action Button */}
      <button
        onClick={handleAddSelected}
        style={{
          width: "100%",
          padding: "8px",
          backgroundColor: "#444a5a",
          color: "#ffd700",
          border: "1px dashed #ffd700",
          borderRadius: "6px",
          fontWeight: "bold",
          cursor: "pointer",
          marginBottom: "12px",
          fontSize: "13px",
        }}
      >
        ➕ Add Selected Tokens
      </button>

      {/* Initiative Entries */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {entries.map((entry, idx) => {
          const isActive = inCombat && idx === activeIndex;
          const isUnconscious = entry.hp === 0;

          return (
            <div
              key={entry.id}
              style={{
                padding: "10px",
                backgroundColor: isActive ? "#3e3b25" : "#2a2d37",
                borderRadius: "6px",
                borderLeft: isActive ? "5px solid #ffd700" : "5px solid transparent",
                opacity: isUnconscious ? 0.7 : 1,
              }}
            >
              {/* Token Name & Delete */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontWeight: "bold", fontSize: "15px" }}>
                  {isActive && "⚔️ "}{entry.name}{" "}
                  {isUnconscious && (
                    <span style={{ color: "#f44336", fontSize: "12px", marginLeft: "4px" }}>
                      💀 Unconscious
                    </span>
                  )}
                </span>
                <button
                  style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}
                  onClick={() => removeEntry(entry.id)}
                >
                  ✕
                </button>
              </div>

              {/* Initiative Controls */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  marginBottom: "8px",
                }}
              >
                <button
                  style={{
                    padding: "2px 6px",
                    backgroundColor: entry.isAuto ? "#2e7d32" : "#ed6c02",
                    color: "#fff",
                    border: "none",
                    borderRadius: "3px",
                    fontWeight: "bold",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleAuto(entry.id)}
                >
                  {entry.isAuto ? "Auto" : "Manual"}
                </button>

                {entry.isAuto ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>Mod:</span>
                    <input
                      type="number"
                      value={entry.modifier}
                      onChange={(e) =>
                        updateEntryValue(entry.id, "modifier", parseInt(e.target.value, 10) || 0)
                      }
                      style={{
                        width: "40px",
                        backgroundColor: "#1e1e24",
                        color: "#fff",
                        border: "1px solid #444",
                        borderRadius: "3px",
                        padding: "2px",
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>Roll:</span>
                    <input
                      type="number"
                      value={entry.score}
                      onChange={(e) =>
                        updateEntryValue(entry.id, "score", parseInt(e.target.value, 10) || 0)
                      }
                      style={{
                        width: "45px",
                        backgroundColor: "#1e1e24",
                        color: "#fff",
                        border: "1px solid #444",
                        borderRadius: "3px",
                        padding: "2px",
                      }}
                    />
                  </div>
                )}

                <div style={{ marginLeft: "auto", fontSize: "14px", fontWeight: "bold", color: "#ffd700" }}>
                  Init: {entry.score}
                </div>
              </div>

              {/* HP Controls */}
              <div style={{ backgroundColor: "#1e1e24", padding: "6px", borderRadius: "4px", fontSize: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontWeight: "bold", color: "#aaa" }}>HP:</span>
                    <input
                      type="number"
                      value={entry.hp}
                      onChange={(e) =>
                        updateEntryValue(entry.id, "hp", parseInt(e.target.value, 10) || 0)
                      }
                      style={{
                        width: "40px",
                        backgroundColor: "#2a2d37",
                        color: "#fff",
                        border: "1px solid #444",
                        borderRadius: "3px",
                        padding: "2px 4px",
                      }}
                    />
                    <span>/</span>
                    <input
                      type="number"
                      value={entry.maxHp}
                      disabled={inCombat}
                      onChange={(e) =>
                        updateEntryValue(entry.id, "maxHp", parseInt(e.target.value, 10) || 0)
                      }
                      style={{
                        width: "40px",
                        backgroundColor: inCombat ? "#181a20" : "#2a2d37",
                        color: inCombat ? "#666" : "#888",
                        border: "1px solid #444",
                        borderRadius: "3px",
                        padding: "2px 4px",
                        cursor: inCombat ? "not-allowed" : "text",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "3px" }}>
                    <button
                      style={{
                        padding: "2px 5px",
                        backgroundColor: "#c62828",
                        color: "#fff",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        fontSize: "10px",
                      }}
                      onClick={() => adjustHp(entry.id, -5)}
                    >
                      -5
                    </button>
                    <button
                      style={{
                        padding: "2px 5px",
                        backgroundColor: "#d32f2f",
                        color: "#fff",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        fontSize: "10px",
                      }}
                      onClick={() => adjustHp(entry.id, -1)}
                    >
                      -1
                    </button>
                    <button
                      style={{
                        padding: "2px 5px",
                        backgroundColor: "#388e3c",
                        color: "#fff",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        fontSize: "10px",
                      }}
                      onClick={() => adjustHp(entry.id, 1)}
                    >
                      +1
                    </button>
                    <button
                      style={{
                        padding: "2px 5px",
                        backgroundColor: "#2e7d32",
                        color: "#fff",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                        fontSize: "10px",
                      }}
                      onClick={() => adjustHp(entry.id, 5)}
                    >
                      +5
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Conditions Display */}
              <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {(entry.conditions || []).map((cond) => {
                  const preset = PRESET_CONDITIONS.find((p) => p.name === cond);
                  const bg = preset ? preset.color : "#444a5a";

                  return (
                    <span
                      key={cond}
                      onClick={() => toggleCondition(entry.id, cond)}
                      style={{
                        backgroundColor: bg,
                        color: "#fff",
                        fontSize: "10px",
                        fontWeight: "bold",
                        padding: "2px 6px",
                        borderRadius: "10px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
                      {cond} ✕
                    </span>
                  );
                })}
              </div>

              {/* Condition Quick Selector */}
              <div
                style={{
                  marginTop: "6px",
                  display: "flex",
                  gap: "4px",
                  overflowX: "auto",
                  paddingBottom: "2px",
                }}
              >
                {PRESET_CONDITIONS.map((p) => {
                  const isActive = (entry.conditions || []).includes(p.name);
                  return (
                    <button
                      key={p.name}
                      onClick={() => toggleCondition(entry.id, p.name)}
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        borderRadius: "4px",
                        border: isActive ? `1px solid ${p.color}` : "1px solid #444",
                        backgroundColor: isActive ? p.color : "#1e1e24",
                        color: isActive ? "#fff" : "#888",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isActive ? `✓ ${p.name}` : `+ ${p.name}`}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
