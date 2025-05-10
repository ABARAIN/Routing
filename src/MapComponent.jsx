import React, { useEffect, useRef, useState } from 'react';
import {
  Drawer, List, ListItem, ListItemText,
  FormControl, InputLabel, Select, MenuItem, Typography,
  Autocomplete, TextField, Button
} from '@mui/material';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

const ORS_API_KEY = '5b3ce3597851110001cf6248872721bb5e674a1aa9d6e7e5269d41ce';
const BUFFER = 0.0007;

const basemaps = {
  OpenStreetMap: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  CartoLight: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  CartoDark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  ArcGISHybrid: 'HYBRID', // handled separately
  ArcGISSatellite: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ArcGISLabels: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
};

const RouteLayer = ({ onAddStats, onAddClosure, activeBasemap, start, end, mapRef }) => {
  const map = useMap();
  const clickBuffer = useRef([]);
  const avoidPolygons = useRef([]);
  const colorIndex = useRef(0);
  const colorPalette = ['blue', 'green', 'purple', 'orange', 'brown', 'darkcyan'];

  useEffect(() => {
    if (map && mapRef) mapRef.current = map;
  }, [map]);

  const fetchRoute = async (avoid, color) => {
    const body = {
      coordinates: [start, end],
      ...(avoid.length > 0 && {
        options: {
          avoid_polygons: {
            type: 'MultiPolygon',
            coordinates: avoid,
          },
        },
      }),
    };

    try {
      const res = await axios.post(
        'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
        body,
        {
          headers: {
            Authorization: ORS_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      const geo = res.data;
      const seg = geo.features[0].properties.segments[0];

      const coords = geo.features[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      const animatedLine = L.polyline([], { color, weight: 5 }).addTo(map);
      let index = 0;
      const interval = setInterval(() => {
        if (index < coords.length) {
          animatedLine.addLatLng(coords[index++]);
        } else {
          clearInterval(interval);
        }
      }, 10);

      map.fitBounds(L.polyline(coords).getBounds(), { padding: [50, 50] });

      onAddStats({
        color,
        distance: (seg.distance / 1000).toFixed(2),
        duration: (seg.duration / 60).toFixed(1),
        layer: animatedLine,
        visible: true,
      });
    } catch (error) {
      console.error('Error fetching route:', error);
    }
  };

  useEffect(() => {
    if (!start || !end) return;
    fetchRoute([], 'blue');

    const handleClick = async (e) => {
      const clicked = [e.latlng.lng, e.latlng.lat];
      clickBuffer.current.push(clicked);

      if (clickBuffer.current.length === 2) {
        const [p1, p2] = clickBuffer.current;

        const red = L.polyline([[p1[1], p1[0]], [p2[1], p2[0]]], {
          color: 'red',
          weight: 5,
        }).addTo(map);

        const toLatLng = ([lng, lat]) => L.latLng(lat, lng);
        const dist = map.distance(toLatLng(p1), toLatLng(p2)) / 1000;

        onAddClosure({ layer: red, coords: [p1, p2], distance: dist.toFixed(2) });

        avoidPolygons.current.push(bufferLineToPolygon(p1, p2).coordinates);

        const color = colorPalette[(++colorIndex.current) % colorPalette.length];
        await fetchRoute(avoidPolygons.current, color);

        clickBuffer.current = [];
      }
    };

    map.on('click', handleClick);
    const zoom = L.control.zoom({ position: 'topright' });
    zoom.addTo(map);

    return () => {
      map.off('click', handleClick);
      zoom.remove();
    };
  }, [map, start, end]);

  return null;
};

const bufferLineToPolygon = (p1, p2, buffer = BUFFER) => {
  const [lng1, lat1] = p1;
  const [lng2, lat2] = p2;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng1 - buffer, lat1 - buffer],
      [lng1 + buffer, lat1 + buffer],
      [lng2 + buffer, lat2 + buffer],
      [lng2 - buffer, lat2 - buffer],
      [lng1 - buffer, lat1 - buffer],
    ]],
  };
};

export default function MapComponent() {
  const [routeStats, setRouteStats] = useState([]);
  const [closures, setClosures] = useState([]);
  const [basemap, setBasemap] = useState('OpenStreetMap');

  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [startCoords, setStartCoords] = useState(null);
  const [endCoords, setEndCoords] = useState(null);
  const [startOptions, setStartOptions] = useState([]);
  const [endOptions, setEndOptions] = useState([]);

  const mapRef = useRef(null);

  const fetchSuggestions = async (text, setOptions) => {
    if (!text) return;
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: text, format: 'json', addressdetails: 1, limit: 5 },
      });
      setOptions(res.data);
    } catch (e) {
      console.error('Nominatim error:', e);
    }
  };

  const handleAddStats = (route) => {
    setRouteStats((prev) => [...prev, route]);
  };

  const toggleRouteVisibility = (index) => {
    setRouteStats((prev) => {
      const updated = [...prev];
      const route = updated[index];
      if (route.layer) {
        route.visible
          ? mapRef.current.removeLayer(route.layer)
          : route.layer.addTo(mapRef.current);
      }
      updated[index] = { ...route, visible: !route.visible };
      return updated;
    });
  };

  const deleteRoute = (index) => {
    setRouteStats((prev) => {
      const updated = [...prev];
      const route = updated[index];
      if (route.layer) mapRef.current.removeLayer(route.layer);
      updated.splice(index, 1);
      return updated;
    });
  };

  const deleteClosure = (index) => {
    setClosures((prev) => {
      const updated = [...prev];
      const closure = updated[index];
      if (closure.layer) mapRef.current.removeLayer(closure.layer);
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleSelect = (option, type) => {
    if (!option) return;
    const coords = [parseFloat(option.lon), parseFloat(option.lat)];
    if (type === 'start') setStartCoords(coords);
    else setEndCoords(coords);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Drawer
        variant="permanent"
        anchor="left"
        PaperProps={{
          sx: {
            width: 350, padding: 2, marginTop: '30px',
            marginBottom: '20px', marginLeft: '30px',
            height: '80vh', backgroundColor: 'rgba(0,0,0,0.9)',
            borderRadius: 7, border: 'none', boxShadow: 'none', color: '#fff',
          }
        }}
      >
        <Typography variant="h6" gutterBottom>Route Info</Typography>

        <Autocomplete
          freeSolo
          options={startOptions}
          getOptionLabel={(opt) => opt.display_name || ''}
          onInputChange={(_, value) => {
            setStartInput(value);
            fetchSuggestions(value, setStartOptions);
          }}
          onChange={(_, value) => handleSelect(value, 'start')}
          renderInput={(params) => (
            <TextField {...params} label="Start Location" variant="outlined" size="small" sx={{ mb: 2 }}
              InputLabelProps={{ style: { color: '#fff' } }}
              InputProps={{ ...params.InputProps, style: { color: '#fff' } }} />
          )}
        />

        <Autocomplete
          freeSolo
          options={endOptions}
          getOptionLabel={(opt) => opt.display_name || ''}
          onInputChange={(_, value) => {
            setEndInput(value);
            fetchSuggestions(value, setEndOptions);
          }}
          onChange={(_, value) => handleSelect(value, 'end')}
          renderInput={(params) => (
            <TextField {...params} label="End Location" variant="outlined" size="small" sx={{ mb: 2 }}
              InputLabelProps={{ style: { color: '#fff' } }}
              InputProps={{ ...params.InputProps, style: { color: '#fff' } }} />
          )}
        />

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel sx={{ color: '#fff' }}>Basemap</InputLabel>
          <Select value={basemap} label="Basemap"
            onChange={(e) => setBasemap(e.target.value)}
            sx={{ color: '#fff', borderColor: '#fff' }}>
            {Object.keys(basemaps).map((key) => (
              <MenuItem key={key} value={key}>{key}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <List>
          {routeStats.map((r, i) => (
            <ListItem key={i} divider>
              <span style={{ width: 12, height: 12, background: r.color, display: 'inline-block', marginRight: 10 }} />
              <ListItemText
                primary={`Route ${i + 1}`}
                secondary={`${r.distance} km / ${r.duration} min`}
                primaryTypographyProps={{ style: { color: '#fff' } }}
                secondaryTypographyProps={{ style: { color: '#ccc' } }}
              />
              <Button size="small" onClick={() => toggleRouteVisibility(i)}>
                {r.visible ? 'Hide' : 'Show'}
              </Button>
              <Button size="small" color="error" onClick={() => deleteRoute(i)}>Delete</Button>
            </ListItem>
          ))}
        </List>

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Closures</Typography>
        <List>
          {closures.map((c, i) => (
            <ListItem key={i} divider>
              <ListItemText
                primary={`Closure ${i + 1}`}
                secondary={`Distance: ${c.distance} km`}
                primaryTypographyProps={{ style: { color: '#fff' } }}
                secondaryTypographyProps={{ style: { color: '#ccc' } }}
              />
              <Button size="small" color="error" onClick={() => deleteClosure(i)}>Delete</Button>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <div style={{ flex: 1 }}>
        <MapContainer
          center={[40.7, -73.94]}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
        >
          {/* Hybrid layer rendering logic */}
          {basemap === 'ArcGISHybrid' ? (
            <>
              <TileLayer url={basemaps.ArcGISSatellite} />
              <TileLayer url={basemaps.ArcGISLabels} />
            </>
          ) : (
            <TileLayer url={basemaps[basemap]} />
          )}

          {startCoords && endCoords && (
            <RouteLayer
              onAddStats={handleAddStats}
              onAddClosure={(segment) => setClosures((prev) => [...prev, segment])}
              activeBasemap={basemap}
              start={startCoords}
              end={endCoords}
              mapRef={mapRef}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
