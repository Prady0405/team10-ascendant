import { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { animate } from 'framer-motion';

const TimelineContext = createContext(null);

const HIGHLIGHT_DURATION_MS = 1800;
const PLAYBACK_INTERVAL_MS = 120;
const JUMP_DURATION_MS = 1200;

// Telemetry timestamps are always elapsed seconds since mission start (a
// plain number), never wall-clock — every source (backend CSV/live
// sessions, and the client-side fallback parser) normalizes to that unit.
function findClosestIndexByTimestamp(rows, targetSeconds) {
  let closest = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const diff = Math.abs(rows[i].timestamp - targetSeconds);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = i;
    }
  }
  return closest;
}

// Single source of truth for playback position. The map, HUD, telemetry chart,
// and scrubber all read `currentIndex`/`currentRow` from here and nothing else,
// so they can never drift out of sync with one another.
export function TimelineProvider({ rows, children }) {
  const [currentIndex, setCurrentIndexState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [highlightField, setHighlightField] = useState(null);

  const mapControllerRef = useRef(null);
  const jumpAnimationRef = useRef(null);
  const highlightTimeoutRef = useRef(null);

  const registerMapController = useCallback((controller) => {
    mapControllerRef.current = controller;
  }, []);

  const setCurrentIndex = useCallback(
    (i) => {
      jumpAnimationRef.current?.stop();
      setCurrentIndexState(Math.max(0, Math.min(rows.length - 1, i)));
    },
    [rows.length]
  );

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setCurrentIndexState((i) => {
        if (i >= rows.length - 1) return i;
        return i + 1;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, rows.length]);

  useEffect(() => {
    if (playing && currentIndex >= rows.length - 1) setPlaying(false);
  }, [currentIndex, playing, rows.length]);

  const flashHighlight = useCallback((field) => {
    if (!field) return;
    clearTimeout(highlightTimeoutRef.current);
    setHighlightField(field);
    highlightTimeoutRef.current = setTimeout(() => setHighlightField(null), HIGHLIGHT_DURATION_MS);
  }, []);

  // The hero interaction: smoothly animates the scrubber/HUD/chart to `targetIndex`
  // over `duration`ms and asks the map to fly to the same coordinate in lockstep,
  // then pulses `highlight` (an evidence field name) once it arrives.
  const jumpToIndex = useCallback(
    (targetIndex, { animate: shouldAnimate = true, duration = JUMP_DURATION_MS, highlight } = {}) => {
      const target = Math.max(0, Math.min(rows.length - 1, targetIndex));
      setPlaying(false);
      jumpAnimationRef.current?.stop();

      const targetRow = rows[target];
      mapControllerRef.current?.flyTo(targetRow, duration);

      if (!shouldAnimate) {
        setCurrentIndexState(target);
        flashHighlight(highlight);
        return;
      }

      jumpAnimationRef.current = animate(currentIndex, target, {
        duration: duration / 1000,
        ease: [0.65, 0, 0.35, 1],
        onUpdate: (v) => setCurrentIndexState(Math.round(v)),
        onComplete: () => flashHighlight(highlight),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, flashHighlight]
  );

  const jumpToTimestamp = useCallback(
    (timestamp, opts) => jumpToIndex(findClosestIndexByTimestamp(rows, timestamp), opts),
    [rows, jumpToIndex]
  );

  useEffect(
    () => () => {
      jumpAnimationRef.current?.stop();
      clearTimeout(highlightTimeoutRef.current);
    },
    []
  );

  const value = useMemo(
    () => ({
      rows,
      currentIndex,
      currentRow: rows[currentIndex],
      playing,
      play,
      pause,
      togglePlay,
      setCurrentIndex,
      jumpToIndex,
      jumpToTimestamp,
      highlightField,
      flashHighlight,
      registerMapController,
    }),
    [
      rows,
      currentIndex,
      playing,
      play,
      pause,
      togglePlay,
      setCurrentIndex,
      jumpToIndex,
      jumpToTimestamp,
      highlightField,
      flashHighlight,
      registerMapController,
    ]
  );

  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimeline() {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error('useTimeline must be used within a TimelineProvider');
  return ctx;
}
