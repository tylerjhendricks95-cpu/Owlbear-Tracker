import React, { useEffect, useState } from "react";
import OBR, { Item, Text } from "@owlbear-rodeo/sdk";

export interface TrackerEntry {
  id: string; // Token ID
  name: string;
  isAuto: boolean;
  modifier: number;
  score: number;
}

export interface RoomData {
  entries: TrackerEntry[];
  activeIndex: number;
  round: number;
  inCombat: boolean;
}

const METADATA_KEY = "com.tylerjhendricks95-cpu.initiative-tracker/metadata";
const TURN_LABEL_ID = "com.tylerjhendricks95-cpu.initiative-tracker/turn-label";

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [round, setRound] = useState<number>(1);
  const [inCombat, setInCombat] = useState<boolean>(false);

  useEffect(() => {
    OBR.onReady(async () => {
      setIsReady(true);

      // Listen for room metadata changes across players
      OBR.room.onMetadataChange((metadata) => {
        const data = metadata[METADATA_KEY] as RoomData | undefined;
        if (data) {
          setEntries(data.entries || []);
          setActiveIndex(data.activeIndex || 0);
          setRound(data.round || 1);
          setInCombat(data.inCombat || false);
        }
      });

      // Fetch initial room state
      const initial = await OBR.room.getMetadata();
      const data = initial[METADATA_KEY] as RoomData | undefined;
      if (data) {
        setEntries(data.entries || []);
        setActiveIndex(data.activeIndex || 0);
        setRound(data.round || 1);
        setInCombat(data.inCombat || false);
      }
    });
  }, []);

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
      await updateMapTurnLabel(newEntries[newActiveIdx]?.id);
    } else {
      await removeMapTurnLabel();
    }
  };

  // Add currently selected token from the board
  const addSelectedToken = async () => {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      alert("Please select a token on the map board first!");
      return;
    }

    const items = await OBR.scene.items.getItems(selection);
    const newEntries = [...entries];

    for (const item of items) {
      if (newEntries.some((e) => e.id === item.id)) continue;

      const tokenName = item.name || "Token";
      const modInput = prompt(`Enter initiative modifier for "${tokenName}":`, "0");
      const modifier = parseInt(modInput || "0", 10) || 0;
      const roll = Math.floor(Math.random() * 20) + 1;

      newEntries.push({
        id: item.id,
        name: tokenName,
        isAuto: true,
        modifier: modifier,
        score: roll + modifier,
      });
    }

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  // Toggle Auto vs Manual
  const toggleAuto = async (id: string) => {
    const newEntries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      const nextIsAuto = !entry.isAuto;
      let newScore = entry.score;

      if (nextIsAuto) {
        const roll = Math.floor(Math.random() * 20) + 1;
        newScore = roll + entry.modifier;
      }

      return { ...entry, isAuto: nextIsAuto, score: newScore };
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  // Update Manual Score / Modifier
  const updateEntryValue = async (id: string, field: "score" | "modifier", val: number) => {
    const newEntries = entries.map((e) => {
      if (e.id !== id) return e;
      if (field === "score") return { ...e, score: val };
      if (field === "modifier") {
        const roll = Math.floor(Math.random() * 20) + 1;
        return { ...e, modifier: val, score: e.isAuto ? roll + val : e.score };
      }
      return e;
    });

    await saveRoomState(newEntries, activeIndex, round, inCombat);
  };

  // Start Combat: Sort highest to lowest & highlight top player
  const startCombat = async () => {
    if (entries.length === 0) return;
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    await saveRoomState(sorted, 0, 1, true);
  };

  const nextTurn = async () => {
    if (entries.length === 0) return;
    let nextIdx = activeIndex + 1;
    let nextRound = round;

    if (nextIdx >= entries.length) {
      nextIdx = 0;
      nextRound += 1; // Increment round counter after all go
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

  // Draw floating text above the active token
  const updateMapTurnLabel = async (activeTokenId: string | null) => {
    if (!activeTokenId) {
      await removeMapTurnLabel();
      return;
    }

    const items = await OBR.scene.items.getItems([activeTokenId]);
    const activeToken = items[0];
    if (!activeToken) return;

    // Remove any existing label first
    await removeMapTurnLabel();

    // Create a new floating text label above the token position
    const label: Text = {
      id: TURN_LABEL_ID,
      type: "TEXT",
      name: "Turn Indicator",
      layer: "TEXT",
      position: {
        x: activeToken.position.x,
        y: activeToken.position.y - 60, // Position above token
      },
      rotation: 0,
      scale: { x: 1, y: 1 },
      visible: true,
      locked: true,
      attachedTo: activeToken.id,
      text: {
        plainText: "⚔️ Active Turn",
        style: {
          fillColor: "#FFD700",
          fontSize: 24,
          fontFamily: "sans-serif",
          fontWeight: "bold",
          textAlign: "CENTER",
          lineHeight: 1,
        },
      },
    } as unknown as Text;

    await OBR.scene.items.addItems([label]);
  };

  const removeMapTurnLabel = async () => {
    await OBR.scene.items.deleteItems([TURN_LABEL_ID]);
  };

  if (!isReady) {
    return <div style={{ padding: 16, color: "#fff" }}>Connecting to Owlbear Rodeo...</div>;
  }

  return (
    <div style={{ padding: "12px", color: "#fff", backgroundColor: "#1e1e24", minHeight: "100vh", boxSizing: "border-box", fontFamily: "sans-serif" }}>
      <h2 style={{ margin: "0 0 8px 0", textAlign: "center", fontSize: "18px" }}>Initiative Tracker</h2>

      {/* Round & Combat Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#2a2d37", padding: "8px 12px", borderRadius: "6px", marginBottom: "12px" }}>
        <span style={{ fontWeight: "bold", fontSize: "14px", color: "#ffd700" }}>Round: {round}</span>
        {!inCombat ? (
          <button style={{ padding: "6px 12px", backgroundColor: "#2e7d32", color: "#fff", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }} onClick={startCombat} disabled={entries.length === 0}>⚔️ Start Combat</button>
        ) : (
          <div style={{ display: "flex", gap: "6px" }}>
            <button style={{ padding: "6px 12px", backgroundColor: "#1976d2", color: "#fff", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }} onClick={nextTurn}>Next Turn ▶</button>
            <button style={{ padding: "6px 8px", backgroundColor: "#c62828", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }} onClick={endCombat}>End</button>
          </div>
        )}
      </div>

      <button style={{ width: "100%", padding: "8px", backgroundColor: "#3a3d4a", color: "#fff", border: "1px dashed #666", borderRadius: "6px", marginBottom: "12px", fontWeight: "bold", cursor: "pointer" }} onClick={addSelectedToken}>
        + Add Selected Token
      </button>

      {/* Initiative Entries */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {entries.map((entry, idx) => {
          const isActive = inCombat && idx === activeIndex;
          return (
            <div
              key={entry.id}
              style={{
                padding: "10px",
                backgroundColor: isActive ? "#3e3b25" : "#2a2d37",
                borderRadius: "6px",
                borderLeft: isActive ? "5px solid #ffd700" : "5px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontWeight: "bold", fontSize: "15px" }}>
                  {isActive && "⚔️ "}{entry.name}
                </span>
                <button style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }} onClick={() => removeEntry(entry.id)}>✕</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                {/* Auto / Manual Toggle Button */}
                <button
                  style={{
                    padding: "4px 8px",
                    backgroundColor: entry.isAuto ? "#2e7d32" : "#ed6c02",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleAuto(entry.id)}
                >
                  {entry.isAuto ? "Auto" : "Manual"}
                </button>

                {/* Conditional Inputs */}
                {entry.isAuto ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>Mod:</span>
                    <input
                      type="number"
                      value={entry.modifier}
                      onChange={(e) => updateEntryValue(entry.id, "modifier", parseInt(e.target.value, 10) || 0)}
                      style={{ width: "45px", backgroundColor: "#1e1e24", color: "#fff", border: "1px solid #444", borderRadius: "3px", padding: "2px 4px" }}
                    />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>Roll:</span>
                    <input
                      type="number"
                      value={entry.score}
                      onChange={(e) => updateEntryValue(entry.id, "score", parseInt(e.target.value, 10) || 0)}
                      style={{ width: "55px", backgroundColor: "#1e1e24", color: "#fff", border: "1px solid #444", borderRadius: "3px", padding: "2px 4px" }}
                    />
                  </div>
                )}

                <div style={{ marginLeft: "auto", fontSize: "16px", fontWeight: "bold", color: "#ffd700" }}>
                  Total: {entry.score}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
