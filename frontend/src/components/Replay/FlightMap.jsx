import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './FlightMap.css';

function droneIcon(heading, pulsing) {
  return L.divIcon({
    className: '',
    html: `<div class="drone-marker${pulsing ? ' drone-marker-pulse' : ''}" style="transform: rotate(${heading}deg)">
             <svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2 L19.5 20 L12 16 L4.5 20 Z" fill="#ffb300" stroke="#07090c" stroke-width="1"/></svg>
           </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Registers an imperative flyTo controller with the TimelineContext so a
// narrative-line click can pan/zoom the map in lockstep with the scrubber.
function MapController() {
  const map = useMap();
  const { registerMapController } = useTimeline();

  useEffect(() => {
    registerMapController({
      flyTo: (row, durationMs) => {
        if (row.latitude == null || row.longitude == null) return;
        map.flyTo([row.latitude, row.longitude], Math.max(map.getZoom(), 17), {
          duration: durationMs / 1000,
          easeLinearity: 0.25,
        });
      },
    });
  }, [map, registerMapController]);

  return null;
}

// A fixed initial zoom only ever suits one spatial scale — a real flight
// could be a 30m test loop or a 30km survey, anywhere on Earth. Fitting to
// the actual path bounds on mount makes the map correct regardless of
// where the mission flew or how large an area it covered.
function FitBoundsOnMount({ path }) {
  const map = useMap();

  useEffect(() => {
    if (path.length === 0) return;
    if (path.length === 1) {
      map.setView(path[0], 17);
      return;
    }
    map.fitBounds(L.latLngBounds(path), { padding: [32, 32], maxZoom: 18 });
    // Intentionally run once on mount only — the timeline's flyTo/marker
    // updates handle all subsequent movement; re-fitting on every render
    // would fight the user's own pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

function CornerBrackets() {
  return (
    <div className="map-corner-brackets" aria-hidden="true">
      <span className="map-corner map-corner-tl" />
      <span className="map-corner map-corner-tr" />
      <span className="map-corner map-corner-bl" />
      <span className="map-corner map-corner-br" />
    </div>
  );
}

function formatCoord(value, positiveLabel, negativeLabel) {
  if (value == null) return '—';
  const direction = value >= 0 ? positiveLabel : negativeLabel;
  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

export default function FlightMap() {
  const { rows, currentRow, highlightField } = useTimeline();
  const path = useMemo(
    () => rows.filter((r) => r.latitude != null && r.longitude != null).map((r) => [r.latitude, r.longitude]),
    [rows]
  );

  const icon = useMemo(
    () => droneIcon(currentRow.yaw ?? 0, highlightField === 'latitude' || highlightField === 'longitude'),
    [currentRow.yaw, highlightField]
  );

  if (path.length === 0 || currentRow.latitude == null || currentRow.longitude == null) {
    return (
      <div className="flight-map flight-map-empty">
        <CornerBrackets />
        <div className="radar-sweep">
          <div className="radar-ring radar-ring-1" />
          <div className="radar-ring radar-ring-2" />
          <div className="radar-sweep-beam" />
        </div>
        <span className="mono">NO GPS TRACK — IMU-ONLY SESSION</span>
      </div>
    );
  }

  return (
    <div className="flight-map">
      <MapContainer
        center={path[0]}
        zoom={16}
        zoomControl={false}
        attributionControl={false}
        className="flight-map-container"
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <Polyline positions={path} pathOptions={{ color: '#ffb300', weight: 6, opacity: 0.12 }} />
        <Polyline positions={path} pathOptions={{ color: '#ffb300', weight: 2, opacity: 0.65 }} />
        <Marker position={[currentRow.latitude, currentRow.longitude]} icon={icon} />
        <MapController />
        <FitBoundsOnMount path={path} />
      </MapContainer>
      <CornerBrackets />
      <div className="map-coord-readout mono">
        {formatCoord(currentRow.latitude, 'N', 'S')} &nbsp; {formatCoord(currentRow.longitude, 'E', 'W')}
      </div>
    </div>
  );
}
