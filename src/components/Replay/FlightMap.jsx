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
        map.flyTo([row.lat, row.lon], Math.max(map.getZoom(), 17), {
          duration: durationMs / 1000,
          easeLinearity: 0.25,
        });
      },
    });
  }, [map, registerMapController]);

  return null;
}

export default function FlightMap() {
  const { rows, currentRow, highlightField } = useTimeline();
  const path = useMemo(() => rows.map((r) => [r.lat, r.lon]), [rows]);
  const icon = useMemo(
    () => droneIcon(currentRow.heading_deg ?? 0, highlightField === 'lat' || highlightField === 'lon'),
    [currentRow.heading_deg, highlightField]
  );

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
        <Polyline positions={path} pathOptions={{ color: '#ffb300', weight: 2, opacity: 0.5 }} />
        <Marker position={[currentRow.lat, currentRow.lon]} icon={icon} />
        <MapController />
      </MapContainer>
    </div>
  );
}
