/**
 * Global Call for Solutions Analytics Dashboard
 * Main application logic for data visualization and filtering
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  MATURITY_ORDER: ["Idea/Concept", "Proof of Concept", "MVP", "Pilot Stage", "Implemented at scale"],
  CHART_COLORS: ['#00A3E0', '#45FFD3', '#F6C453', '#118E9C', '#1BC7BE'],
  MAX_TOP_SOLUTIONS: 10,
  CSV_FILENAME: 'global_solutions_export.csv',
  MAPBOX_TOKEN: 'pk.eyJ1Ijoiemlsb25nLXRlY2giLCJhIjoiY21mMmhvZWp0MXZtdjJpcXlzOWswZGM1ZiJ9.tk_JMGIpKj5KS4bSBEukqw'
};

// ============================================================================
// UTILITIES
// ============================================================================

const utils = {
  toArray: v => Array.isArray(v) ? v : (v ? [v] : []),
  unique: arr => [...new Set(arr)].filter(Boolean).sort(),
  safeNumber: v => { 
    const n = Number(v); 
    return isFinite(n) ? n : 0; 
  },
  formatNumber: (num, decimals = 1) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return (+num).toFixed(decimals);
  },
  debounce: (fn, wait = 300) => { 
    let t; 
    return (...a) => { 
      clearTimeout(t); 
      t = setTimeout(() => fn(...a), wait); 
    }; 
  }
};

const el = id => document.getElementById(id);

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

const PlotTheme = {
  paper: 'rgba(0,0,0,0)',
  plot: 'rgba(0,0,0,0)',
  fontColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#EAF4FF',
  grid: 'rgba(255,255,255,.08)'
};

const commonLayout = {
  paper_bgcolor: PlotTheme.paper,
  plot_bgcolor: PlotTheme.plot,
  font: { color: PlotTheme.fontColor, size: 16 },
  margin: { t: 10, r: 10, b: 50, l: 60 },
  xaxis: { gridcolor: PlotTheme.grid, zeroline: false },
  yaxis: { gridcolor: PlotTheme.grid, zeroline: false },
};

const ThemeManager = {
  currentTheme: 'dark',
  
  init() {
    const savedTheme = localStorage.getItem('unga-theme');
    if (savedTheme) {
      this.setTheme(savedTheme);
    }
  },
  
  setTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    localStorage.setItem('unga-theme', theme);
    
    const toggleBtn = document.getElementById('toggleTheme');
    if (toggleBtn) {
      toggleBtn.innerHTML = theme === 'light' ? '🌙' : '☀️';
      toggleBtn.title = theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    }
    
    console.log(`Theme changed to ${theme}. Map will use ${theme} style on next creation.`);
  },
  
  toggle() {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
    
    if (window.map) {
      console.log('Recreating map with new theme...');
      window.map.remove();
      window.map = null;
      setTimeout(() => {
        if (typeof renderAll === 'function') {
          renderAll();
        }
      }, 100);
    }
  }
};

// ============================================================================
// DATA PROCESSING
// ============================================================================

const sdgNormalize = (s) => {
  if (!s) return [];
  return s.split(';').map(x => x.trim()).filter(Boolean)
    .map(x => {
      if (x.includes('ЦУР 10') || x.includes('сокращение неравенства')) return 'SDG 10';
      if (x.includes('ЦУР 12') || x.includes('Ответственное потребление и производство')) return 'SDG 12';
      if (x.includes('ЦУР 8') || x.includes('Достойный труд и экономический рост')) return 'SDG 8';
      return x.replace(/^SDG\s*/i, 'SDG ').replace(/\s+/g, ' ');
    })
    .map(x => x.replace(/^(SDG)?\s*(\d{1,2}).*$/i, (_, __, n) => `SDG ${n}`));
};

const DataProcessor = {
  normalizeRow(row) {
    const country = (row['Country'] || '').trim();
    const iso3 = window.COUNTRY_TO_ISO3?.[country] || null;
    const sdgs = sdgNormalize(row['SDGs addressed']);
    
    let maturity = (row['Maturity stage'] || '').trim();
    if (maturity === 'Пилотный этап (мелкая реализация)') {
      maturity = 'Pilot stage (small-scale implementation)';
    }
    if (/Proof-of-Concept|Prototype/i.test(maturity)) {
      maturity = 'Proof of Concept';
    } else if (/Minimum Viable Product|MVP|Pilot-ready/i.test(maturity)) {
      maturity = 'MVP';
    } else if (/Pilot stage|small-scale implementation/i.test(maturity)) {
      maturity = 'Pilot Stage';
    }
    
    let org = (row['Please specify the type of organization you are representing.'] || '').replace(/\*+$/, '').trim();
    if (org === 'Частный сектор') {
      org = 'Private sector';
    }
    if (/Academia|university|think tank/i.test(org)) {
      org = 'Academia';
    } else if (/Civil society|NGO|community groups/i.test(org)) {
      org = 'Civil society';
    } else if (/International Organisation/i.test(org) && !/UN/i.test(org)) {
      org = 'International Organisation';
    }
    
    const region = (row['Region'] || '').trim();
    const score = utils.safeNumber(row['Total Score']);
    const theme = (row['Primary thematic focus area'] || '').trim();
    
    return {
      ...row,
      _country: country,
      _iso3: iso3,
      _sdgs: sdgs,
      _maturity: maturity,
      _org: org,
      _region: region,
      _score: score,
      _theme: theme
    };
  },
  
  kpis(data) {
    const countries = utils.unique(data.map(d => d._country));
    const scores = data.map(d => d._score).filter(s => s > 0);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const median = scores.length ? (s => {
      const t = [...s].sort((a, b) => a - b);
      const m = Math.floor(t.length / 2);
      return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
    })(scores) : 0;
    const top = Math.max(...scores, 0);
    
    return { 
      submissions: data.length, 
      countries: countries.length, 
      avg, 
      median, 
      top 
    };
  }
};

// ============================================================================
// APPLICATION STATE
// ============================================================================

class AppState {
  constructor() {
    this.rawData = [];
    this.filters = {
      region: new Set(),
      country: new Set(),
      org: new Set(),
      maturity: new Set(),
      sdg: new Set()
    };
    this.countryRegionMapping = null;
    this.kiosk = true; // default kiosk ON - controls hidden initially
    this.mapProjection = localStorage.getItem('unga-map-projection') || 'equirectangular';
  }
  
  getFilteredData() {
    return this.rawData.filter(r =>
      (this.filters.region.size === 0 || this.filters.region.has(r._region)) &&
      (this.filters.country.size === 0 || this.filters.country.has(r._country)) &&
      (this.filters.org.size === 0 || this.filters.org.has(r._org)) &&
      (this.filters.maturity.size === 0 || this.filters.maturity.has(r._maturity)) &&
      (this.filters.sdg.size === 0 || r._sdgs.some(s => this.filters.sdg.has(s)))
    );
  }
  
  clearFilters() {
    this.filters = {
      region: new Set(),
      country: new Set(),
      org: new Set(),
      maturity: new Set(),
      sdg: new Set()
    };
    updateFilterUI(false);
  }
  
  toggleMapProjection() {
    this.mapProjection = this.mapProjection === 'equirectangular' ? 'globe' : 'equirectangular';
    this.updateMapProjectionButton();
    localStorage.setItem('unga-map-projection', this.mapProjection);
    return this.mapProjection;
  }
  
  updateMapProjectionButton() {
    const btn = el('toggleMapView');
    if (btn) {
      btn.innerHTML = this.mapProjection === 'equirectangular' ? '🌍 2D' : '🌐 3D';
      btn.title = this.mapProjection === 'equirectangular' ? 'Switch to 3D Globe view' : 'Switch to 2D Flat view';
      btn.classList.toggle('active', this.mapProjection === 'globe');
    }
  }
}

const appState = new AppState();

// ============================================================================
// UI RENDERERS
// ============================================================================

function renderKPIs(data) {
  const { submissions, countries, avg, median, top } = DataProcessor.kpis(data);
  el('kpis').innerHTML = `
    <div class="kpi">
      <div class="label">Total Submissions</div>
      <div class="value">${utils.formatNumber(submissions, 0)}</div>
      <div class="hint">entries</div>
    </div>
    <div class="kpi">
      <div class="label">Countries Represented</div>
      <div class="value">${utils.formatNumber(countries, 0)}</div>
      <div class="hint">unique countries</div>
    </div>
    <div class="kpi">
      <div class="label">Average Score</div>
      <div class="value">${utils.formatNumber(avg)}</div>
      <div class="hint">mean</div>
    </div>
    <div class="kpi">
      <div class="label">Top Score</div>
      <div class="value">${utils.formatNumber(top)}</div>
      <div class="hint">max</div>
    </div>
  `;
}

function renderSdgStack(data) {
  const all = utils.unique(data.flatMap(d => d._sdgs));
  const by = Object.fromEntries(all.map(s => [s, 0]));
  data.forEach(d => d._sdgs.forEach(s => by[s] = (by[s] || 0) + 1));
  const sorted = Object.entries(by).sort(([a], [b]) => Number(a.split(' ')[1]) - Number(b.split(' ')[1]));
  const labels = sorted.map(([k]) => k);
  const parents = labels.map(() => '');
  const values = sorted.map(([, v]) => v);
  const trace = { 
    type: 'treemap', 
    labels, 
    parents, 
    values, 
    marker: { colors: CONFIG.CHART_COLORS } 
  };
  Plotly.newPlot('sdgStack', [trace], { ...commonLayout, margin: { t: 10, l: 10, r: 10, b: 10 } }, { displayModeBar: false, responsive: true });
}

function renderScoreHist(data) {
  const scores = data.map(d => d._score).filter(s => s > 0);
  const trace = { 
    type: 'histogram', 
    x: scores, 
    nbinsx: 18, 
    marker: { color: '#1BC7BE', line: { width: 0 } } 
  };
  const layout = { 
    ...commonLayout, 
    xaxis: { ...commonLayout.xaxis, title: 'Score' }, 
    yaxis: { ...commonLayout.yaxis, title: 'Count' } 
  };
  Plotly.newPlot('scoreHist', [trace], layout, { displayModeBar: false, responsive: true });
}

function renderAll() {
  const data = appState.getFilteredData();
  console.log(`🎯 Rendering ${data.length} submissions (filtered from ${appState.rawData.length} total)`);
  renderKPIs(data);
  renderMap(data);
  renderSdgStack(data);
  renderScoreHist(data);
}

// ============================================================================
// MAP FUNCTIONALITY
// ============================================================================

const getCountryCoordinates = (countryName) => {
  const countryCoords = {
    'United States': [-95.7129, 37.0902],
    'Canada': [-106.3468, 56.1304],
    'United Kingdom': [-3.4360, 55.3781],
    'Germany': [10.4515, 51.1657],
    'France': [2.2137, 46.2276],
    'Italy': [12.5674, 41.8719],
    'Spain': [-3.7492, 40.4637],
    'Netherlands': [5.2913, 52.1326],
    'Sweden': [18.6435, 60.1282],
    'Norway': [8.4689, 60.4720],
    'Denmark': [9.5018, 56.2639],
    'Finland': [25.7482, 61.9241],
    'Australia': [133.7751, -25.2744],
    'Japan': [138.2529, 36.2048],
    'South Korea': [127.7669, 35.9078],
    'China': [104.1954, 35.8617],
    'India': [78.9629, 20.5937],
    'Brazil': [-51.9253, -14.2350],
    'Mexico': [-102.5528, 23.6345],
    'Argentina': [-63.6167, -38.4161],
    'South Africa': [22.9375, -30.5595],
    'Nigeria': [8.6753, 9.0820],
    'Kenya': [37.9062, -0.0236],
    'Egypt': [30.8025, 26.8206],
    'Turkey': [35.2433, 38.9637],
    'Russia': [105.3188, 61.5240],
    'Ukraine': [31.1656, 48.3794],
    'Poland': [19.1451, 51.9194],
    'Czech Republic': [15.4730, 49.8175],
    'Austria': [14.5501, 47.5162],
    'Switzerland': [8.2275, 46.8182],
    'Belgium': [4.4699, 50.5039],
    'Ireland': [-8.2439, 53.4129],
    'Portugal': [-8.2245, 39.3999],
    'Greece': [21.8243, 39.0742],
    'Israel': [34.8516, 31.0461],
    'United Arab Emirates': [53.8478, 23.4241],
    'Saudi Arabia': [45.0792, 23.8859],
    'Thailand': [100.9925, 15.8700],
    'Vietnam': [108.2772, 14.0583],
    'Philippines': [121.7740, 12.8797],
    'Indonesia': [113.9213, -0.7893],
    'Malaysia': [101.9758, 4.2105],
    'Singapore': [103.8198, 1.3521],
    'New Zealand': [174.8860, -40.9006],
    'Chile': [-71.5430, -35.6751],
    'Colombia': [-74.2973, 4.5709],
    'Peru': [-75.0152, -9.1900],
    'Venezuela': [-66.5897, 6.4238],
    'Ecuador': [-78.1834, -1.8312],
    'Uruguay': [-55.7658, -32.5228],
    'Paraguay': [-58.4438, -23.4425],
    'Bolivia': [-63.5887, -16.2902],
    'Guyana': [-58.9302, 4.8604],
    'Suriname': [-56.0278, 3.9193],
    'French Guiana': [-53.1258, 3.9339]
  };
  return countryCoords[countryName] || [0, 0];
};

function renderMap(data) {
  try {
    const hasToken = CONFIG.MAPBOX_TOKEN && !/example$/.test(CONFIG.MAPBOX_TOKEN);
    const mapEl = el('map');
    const HINT_ID = 'map-hint';

    const showHint = (html) => {
      if (!mapEl) return;
      let hint = document.getElementById(HINT_ID);
      if (!hint) {
        hint = document.createElement('div');
        hint.id = HINT_ID;
        hint.style.cssText = `
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          color: var(--muted); pointer-events: none; z-index: 2; text-align: center; padding: 24px;
          background: none;
        `;
        mapEl.appendChild(hint);
      }
      hint.innerHTML = html;
    };
    
    const hideHint = () => {
      const hint = document.getElementById(HINT_ID);
      if (hint && hint.parentNode) {
        hint.parentNode.removeChild(hint);
      }
    };

    if (!hasToken) {
      if (!window.map || !window.map.getStyle) {
        mapEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">⚠️ Mapbox token missing. Update CONFIG.MAPBOX_TOKEN.</div>';
      }
      el('mapbox-note').style.display = 'block';
      return;
    }

    // Aggregate counts by ISO3
    const counts = {};
    for (const d of data) if (d._iso3) {
      counts[d._iso3] = (counts[d._iso3] || 0) + 1;
    }
    const maxCount = Math.max(0, ...Object.values(counts));

    // Build expressions
    const countExpr = ['match', ['get', 'iso_3166_1_alpha_3']];
    for (const [iso3, c] of Object.entries(counts)) countExpr.push(iso3, c);
    countExpr.push(0);

    const colorExpr = ['case',
      ['==', countExpr, 0], '#D0D0D0',
      ['interpolate', ['linear'], countExpr,
        1, '#E8F5E8',
        Math.max(1, maxCount * 0.20), '#B3E6B3',
        Math.max(1, maxCount * 0.40), '#7ED67E',
        Math.max(1, maxCount * 0.60), '#4AC64A',
        Math.max(1, maxCount * 0.80), '#16B616',
        Math.max(1, maxCount), '#0B7A0B',
      ]
    ];

    const ensureLayers = () => {
      if (!window.map.getSource('country-bounds')) {
        window.map.addSource('country-bounds', { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' });
      }
      if (!window.map.getLayer('submissions-fill')) {
        window.map.addLayer({
          id: 'submissions-fill',
          type: 'fill',
          source: 'country-bounds',
          'source-layer': 'country_boundaries',
          paint: { 'fill-color': colorExpr, 'fill-opacity': 0.75 }
        });
      } else {
        window.map.setPaintProperty('submissions-fill', 'fill-color', colorExpr);
      }
      if (!window.map.getLayer('submissions-outline')) {
        window.map.addLayer({
          id: 'submissions-outline',
          type: 'line',
          source: 'country-bounds',
          'source-layer': 'country_boundaries',
          paint: { 'line-color': '#0E1A2F', 'line-width': 0.5 }
        });
      }

      // Add clustered markers
      if (!window.map.getSource('submissions')) {
        const geoJsonData = {
          type: 'FeatureCollection',
          features: data.map(d => {
            const coords = getCountryCoordinates(d._country);
            return {
              type: 'Feature',
              properties: {
                country: d._country,
                iso3: d._iso3,
                score: d._score,
                org: d._org,
                maturity: d._maturity,
                id: Math.random()
              },
              geometry: {
                type: 'Point',
                coordinates: coords
              }
            };
          }).filter(f => f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0)
        };

        window.map.addSource('submissions', {
          type: 'geojson',
          data: geoJsonData,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50
        });

        // Add cluster circles
        window.map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'submissions',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#51bbd6',
              10, '#f1f075',
              20, '#f28cb1'
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              15,
              10, 20,
              20, 30
            ]
          }
        });

        // Add cluster count labels
        window.map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'submissions',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12
          }
        });

        // Add unclustered points
        window.map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'submissions',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#11b4da',
            'circle-radius': 8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
          }
        });

        // Add click handlers
        window.map.on('click', 'clusters', (e) => {
          const features = window.map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
          const clusterId = features[0].properties.cluster_id;
          window.map.getSource('submissions').getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            window.map.easeTo({
              center: features[0].geometry.coordinates,
              zoom: zoom
            });
          });
        });

        window.map.on('click', 'unclustered-point', (e) => {
          const coordinates = e.features[0].geometry.coordinates.slice();
          const props = e.features[0].properties;
          
          new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
              <div style="font-weight:700">${props.country}</div>
              <div style="color:var(--muted)">Organization: ${props.org}</div>
              <div style="color:var(--muted)">Maturity: ${props.maturity}</div>
              <div style="color:var(--muted)">Score: ${props.score}</div>
            `)
            .addTo(window.map);
        });

        // Change cursor on hover
        window.map.on('mouseenter', 'clusters', () => {
          window.map.getCanvas().style.cursor = 'pointer';
        });
        window.map.on('mouseleave', 'clusters', () => {
          window.map.getCanvas().style.cursor = '';
        });
        window.map.on('mouseenter', 'unclustered-point', () => {
          window.map.getCanvas().style.cursor = 'pointer';
        });
        window.map.on('mouseleave', 'unclustered-point', () => {
          window.map.getCanvas().style.cursor = '';
        });
      }
    };

    // Create or update map
    if (!window.map || !window.map.getStyle) {
      showHint('🌍 Initializing map…');

      mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
      const mapStyle = ThemeManager.currentTheme === 'light' 
        ? 'mapbox://styles/mapbox/outdoors-v12' 
        : 'mapbox://styles/mapbox/outdoors-v12';
      
      window.map = new mapboxgl.Map({
        container: 'map',
        style: mapStyle,
        center: [0, 20],
        zoom: 1,
        projection: appState.mapProjection
      });
      window.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      window.map.on('error', (e) => {
        console.error('Mapbox error:', e);
        showHint('❌ Map error<br><small>Check token or style</small>');
      });

      window.map.on('load', () => {
        hideHint();
        ensureLayers();
      });
    } else {
      if (window.map.isStyleLoaded) {
        ensureLayers();
      } else {
        showHint('🌍 Updating map…');
        if (!window.__pending_style_load_handler) {
          window.__pending_style_load_handler = true;
          window.map.on('load', () => {
            ensureLayers();
            hideHint();
            window.__pending_style_load_handler = false;
          });
        }
      }
    }
  } catch (err) {
    console.error('Error rendering map:', err);
    const mapEl = el('map');
    if (mapEl) {
      let hint = document.getElementById('map-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'map-hint';
        hint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);pointer-events:none;z-index:2;text-align:center;padding:24px;';
        mapEl.appendChild(hint);
      }
      hint.innerHTML = '❌ Map error<br><small>See console for details</small>';
    }
  }
}

function toggleMapProjection() {
  if (!window.map) return;
  
  const newProjection = appState.toggleMapProjection();
  console.log(`Switching to ${newProjection} projection`);
  
  try {
    window.map.setProjection(newProjection);
    
    if (newProjection === 'globe') {
      const currentZoom = window.map.getZoom();
      if (currentZoom < 1.5) {
        window.map.setZoom(1.5);
      }
    }
    
    const btn = el('toggleMapView');
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = newProjection === 'equirectangular' ? '✅ 2D' : '✅ 3D';
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 1000);
    }
  } catch (err) {
    console.error('Error changing projection:', err);
    console.log('Recreating map with new projection...');
    window.map.remove();
    window.map = null;
    setTimeout(() => {
      if (typeof renderAll === 'function') {
        renderAll();
      }
    }, 100);
  }
}

// ============================================================================
// FILTER MANAGEMENT
// ============================================================================

function fillSelect(id, values) { 
  const s = el(id); 
  if (!s) return; 
  s.innerHTML = values.map(v => `<option value="${v}">${v}</option>`).join(''); 
}

function clearSelect(id) { 
  const s = el(id); 
  if (!s) return; 
  [...s.options].forEach(o => o.selected = false); 
}

function updateFilterUI(resetCountries = true) {
  ['fRegion', 'fCountry', 'fOrg', 'fMaturity', 'fSDG'].forEach(id => clearSelect(id));
  if (resetCountries) {
    fillSelect('fRegion', utils.unique(appState.rawData.map(r => r._region)));
    fillSelect('fCountry', utils.unique(appState.rawData.map(r => r._country)));
  }
}

function setFilterFromSelect(id) {
  const s = el(id); 
  const selected = new Set([...s.selectedOptions].map(o => o.value));
  const key = id.replace('f', '').toLowerCase();
  
  if (key === 'region') { 
    appState.filters.region = selected; 
    updateCountryFilter(selected); 
  }
  if (key === 'country') { 
    appState.filters.country = selected; 
    updateRegionFilter(selected); 
  }
  if (key === 'org') appState.filters.org = selected;
  if (key === 'maturity') appState.filters.maturity = selected;
  if (key === 'sdg') appState.filters.sdg = selected;
}

function updateCountryFilter(selectedRegions) {
  if (!appState.countryRegionMapping) return;
  if (selectedRegions.size === 0) { 
    fillSelect('fCountry', utils.unique(appState.rawData.map(r => r._country))); 
    return; 
  }
  const valid = new Set();
  selectedRegions.forEach(region => {
    (appState.countryRegionMapping.region_to_countries[region] || []).forEach(c => { 
      if (appState.rawData.some(r => r._country === c)) valid.add(c); 
    });
  });
  fillSelect('fCountry', Array.from(valid).sort()); 
  appState.filters.country.clear(); 
  clearSelect('fCountry');
}

function updateRegionFilter(selectedCountries) {
  if (!appState.countryRegionMapping) return;
  if (selectedCountries.size === 0) { 
    fillSelect('fRegion', utils.unique(appState.rawData.map(r => r._region))); 
    return; 
  }
  const valid = new Set();
  selectedCountries.forEach(country => { 
    const region = appState.countryRegionMapping.country_to_region[country]; 
    if (region) valid.add(region); 
  });
  fillSelect('fRegion', Array.from(valid).sort()); 
  appState.filters.region.clear(); 
  clearSelect('fRegion');
}

// ============================================================================
// UI CONTROLS
// ============================================================================

function toggleKioskMode() {
  appState.kiosk = !appState.kiosk;
  const controls = el('controls');
  
  if (appState.kiosk) {
    controls.classList.remove('show');
    el('toggleKiosk').textContent = 'Show Controls';
    el('toggleKiosk').title = 'Show filter controls';
  } else {
    controls.classList.add('show');
    el('toggleKiosk').textContent = 'Kiosk';
    el('toggleKiosk').title = 'Hide filter controls';
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  // Initialize theme manager
  ThemeManager.init();
  
  // Set up event listeners
  ['fRegion', 'fCountry', 'fOrg', 'fMaturity', 'fSDG'].forEach(id => {
    el(id)?.addEventListener('change', utils.debounce(() => { 
      setFilterFromSelect(id); 
      renderAll(); 
    }, 250));
  });
  
  el('clear')?.addEventListener('click', () => { 
    appState.clearFilters(); 
    renderAll(); 
  });
  el('toggleKiosk')?.addEventListener('click', toggleKioskMode);
  el('toggleTheme')?.addEventListener('click', () => { ThemeManager.toggle(); });
  el('toggleMapView')?.addEventListener('click', toggleMapProjection);

  // Load mapping data (optional)
  try { 
    const m = await fetch('country_region_mapping.json'); 
    if (m.ok) appState.countryRegionMapping = await m.json(); 
  } catch { /* noop */ }

  // Load main data
  const res = await fetch('data.json');
  if (!res.ok) throw new Error('Failed to load data.json');
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty or invalid data');

  appState.rawData = raw.map(DataProcessor.normalizeRow);
  
  // Populate filter selects
  fillSelect('fRegion', utils.unique(appState.rawData.map(r => r._region)));
  fillSelect('fCountry', utils.unique(appState.rawData.map(r => r._country)));
  fillSelect('fOrg', utils.unique(appState.rawData.map(r => r._org)));
  
  const maturityValues = utils.unique(appState.rawData.map(r => r._maturity)).sort((a, b) => {
    const ai = CONFIG.MATURITY_ORDER.indexOf(a);
    const bi = CONFIG.MATURITY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  fillSelect('fMaturity', maturityValues);
  fillSelect('fSDG', utils.unique(appState.rawData.flatMap(r => r._sdgs)));

  // Initial render
  renderAll();
  
  // Update map projection button text
  appState.updateMapProjectionButton();
  
  // Apply initial kiosk state (hide controls by default)
  toggleKioskMode();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);