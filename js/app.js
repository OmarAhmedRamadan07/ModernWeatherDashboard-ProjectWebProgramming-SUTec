// =========================================================
// 1. Configuration & Global Variables
// =========================================================
const API_KEY = 'dc6995fce2cbfe9781f339cb5d7a2288'; 

let map;
let marker;
let forecastChartInstance = null; 
let currentHourlyData = null; 
let currentHourlyIndex = 0;
let _lastVideoSrc = '';
let _localClockInterval = null;

// =========================================================
// 2. Cloudinary Base URL
// =========================================================
const CLOUD = 'https://res.cloudinary.com/dp91c7ouo/video/upload/';

// =========================================================
// Backend API URL
// =========================================================
const BACKEND = 'https://modernweatherdashboard-projectwebprogramming-sut-production.up.railway.app';

// Generate a unique session ID for each user
let _sessionId = localStorage.getItem('sessionId');
if (!_sessionId) {
    _sessionId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('sessionId', _sessionId);
}

// Register a visit to the backend
async function registerVisit() {
    try {
        await fetch(`${BACKEND}/api/visit`, { method: 'POST' });
    } catch(e) {}
}

// Fetch saved favorite cities from backend
async function getFavorites() {
    try {
        const res = await fetch(`${BACKEND}/api/favorites/${_sessionId}`);
        const data = await res.json();
        return data.cities || [];
    } catch(e) { return []; }
}

// Add a city to favorites
async function addFavorite(city, country, lat, lon) {
    try {
        const res = await fetch(`${BACKEND}/api/favorites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: _sessionId, city, country, lat, lon })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:`${city} saved!`, timer:1500, showConfirmButton:false, toast:true, position:'top-end' });
            renderFavorites();
        }
    } catch(e) {
        Swal.fire({ icon:'error', title:'Could not save city', timer:1500, showConfirmButton:false, toast:true, position:'top-end' });
    }
}

// Remove a city from favorites
async function removeFavorite(city) {
    try {
        await fetch(`${BACKEND}/api/favorites/${_sessionId}/${encodeURIComponent(city)}`, { method: 'DELETE' });
        renderFavorites();
    } catch(e) {}
}

// Render favorite cities list
async function renderFavorites() {
    const cities = await getFavorites();
    const container = document.getElementById('favorites-container');
    if (!container) return;
    if (cities.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem;">No saved cities yet. Search for a city and click ★ to save it.</p>';
        return;
    }
    container.innerHTML = cities.map(c => `
        <div class="favorite-city-item" onclick="fetchWeatherData('${c.city}')" style="display:flex;justify-content:space-between;align-items:center;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:12px;padding:12px 16px;cursor:pointer;margin-bottom:8px;transition:all 0.3s ease;">
            <span>🌍 <strong>${c.city}</strong>${c.country ? ', '+c.country : ''}</span>
            <button onclick="event.stopPropagation();removeFavorite('${c.city}')" style="background:transparent;border:none;color:#ef4444;cursor:pointer;font-size:1.2rem;">✕</button>
        </div>
    `).join('');
}

// =========================================================
// 3. Data Adapters & Helpers
// =========================================================
function wmoToDescription(code, is_day = 1) {
    const d_n = is_day ? "d" : "n";
    let desc = "clear sky", id = 800, main = "Clear", iconCode = "01";
    if (code === 0)  { desc="clear sky"; id=800; main="Clear"; iconCode="01"; }
    else if (code===1) { desc="few clouds"; id=801; main="Clouds"; iconCode="02"; }
    else if (code===2) { desc="scattered clouds"; id=802; main="Clouds"; iconCode="03"; }
    else if (code===3) { desc="overcast clouds"; id=804; main="Clouds"; iconCode="04"; }
    else if (code===45||code===48) { desc="fog"; id=741; main="Fog"; iconCode="50"; }
    else if (code>=51&&code<=57) { desc="drizzle"; id=300; main="Drizzle"; iconCode="09"; }
    else if (code===61||code===63||code===80||code===81) { desc="moderate rain"; id=501; main="Rain"; iconCode="10"; }
    else if (code===65||code===82) { desc="heavy rain"; id=502; main="Rain"; iconCode="09"; }
    else if (code===66||code===67) { desc="freezing rain"; id=611; main="Snow"; iconCode="13"; }
    else if ((code>=71&&code<=77)||code===85||code===86) { desc="snow"; id=600; main="Snow"; iconCode="13"; }
    else if (code>=95&&code<=99) { desc="thunderstorm"; id=200; main="Thunderstorm"; iconCode="11"; }
    return { desc, id, icon: iconCode+d_n, main };
}

function getWeatherIcon(condition) {
    const desc = condition.toLowerCase();
    const path = "images/"; 
    if (desc.includes("clear"))                return `${path}clear.png`;
    if (desc.includes("few clouds"))           return `${path}Few-clouds.png`;
    if (desc.includes("scattered clouds"))     return `${path}Scattered-clouds.png`;
    if (desc.includes("broken clouds"))        return `${path}Broken-clouds.png`;
    if (desc.includes("overcast clouds"))      return `${path}Overcast-clouds.png`;
    if (desc.includes("drizzle")||desc.includes("light rain")) return `${path}Light-rain.png`;
    if (desc.includes("moderate rain"))        return `${path}Moderate-rain.png`;
    if (desc.includes("heavy rain")||desc.includes("intensity")) return `${path}Heavy-intensity-rain.png`;
    if (desc.includes("thunderstorm with rain")) return `${path}Thunderstorm-with-rain.png`;
    if (desc.includes("thunderstorm"))         return `${path}Thunderstorm.png`;
    if (desc.includes("snow")||desc.includes("freezing")) return `${path}Light-snow.png`;
    if (desc.includes("mist")||desc.includes("fog")||desc.includes("haze")) return `${path}Fog.png`;
    return `${path}icon.png`; 
}

function getWindDirection(degree) {
    const directions = ['N','NE','E','SE','S','SW','W','NW'];
    return directions[Math.round(degree/45)%8];
}

function formatTime(isoString) {
    if (!isoString) return "--:--";
    return new Date(isoString).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
}

// Live local clock for the selected city
function startLocalClock(timezone) {
    if (_localClockInterval) clearInterval(_localClockInterval);
    function tick() {
        const el = document.getElementById('local-clock');
        if (!el) return;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            timeZone: timezone,
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
        const dateStr = now.toLocaleDateString('en-US', {
            timeZone: timezone,
            weekday: 'short', month: 'short', day: 'numeric'
        });
        el.innerHTML = `<span class="clock-time">${timeStr}</span><span class="clock-date">${dateStr}</span>`;
    }
    tick();
    _localClockInterval = setInterval(tick, 1000);
}

// =========================================================
// 4. Audio & Video Management
// =========================================================
const weatherSounds = {
    'storm-heavy':  new Audio(`${CLOUD}storm-heavy_rndq5z.mp3`),
    'storm-light':  new Audio(`${CLOUD}storm-light_o0e6wh.mp3`),
    'thunder-only': new Audio(`${CLOUD}thunder-only_fz2yi3.mp3`),
    'rain-heavy':   new Audio(`${CLOUD}rain-heavy_jpf17d.mp3`),
    'rain-medium':  new Audio(`${CLOUD}rain-shower_wuw9to.mp3`),
    'rain-light':   new Audio(`${CLOUD}rain-light_tzit6n.mp3`),
    'snow':         new Audio(`${CLOUD}snow_s5rwzl.mp3`),
    'wind-strong':  new Audio(`${CLOUD}wind-strong_apnkt2.mp3`),
    'wind-light':   new Audio(`${CLOUD}wind-light_vcvkmw.mp3`),
    'clear-day':    new Audio(`${CLOUD}clear-day_shmjca.mp3`),
    'clear-night':  new Audio(`${CLOUD}clear-night_rp1z80.mp3`),
    'click':        new Audio(`${CLOUD}click_ignifg.mp3`),
    'success':      new Audio(`${CLOUD}success_ygqb3i.mp3`),
    'error':        new Audio(`${CLOUD}error_jplofl.mp3`)
};

Object.keys(weatherSounds).forEach(key => {
    if (!['click','success','error'].includes(key)) weatherSounds[key].loop = true;
});

let currentPlayingSound = null;

function playClickSound() {
    const snd = getSound('click');
    snd.currentTime = 0;
    snd.play().catch(()=>{});
}

function playWeatherSound(data) {
    if (currentPlayingSound) { currentPlayingSound.pause(); currentPlayingSound.currentTime = 0; }
    const code = data.weather[0].id;
    const isNight = data.is_day === 0 || (data.weather[0].icon||'').includes('n');
    let soundKey = '';
    if (code>=200&&code<=299) soundKey = 'storm-heavy';
    else if (code>=300&&code<=501) soundKey = 'rain-light';
    else if (code>=502&&code<=531) soundKey = 'rain-heavy';
    else if (code>=600&&code<=699) soundKey = 'snow';
    else if (code===800) soundKey = isNight ? 'clear-night' : 'clear-day';
    else if (code===801||code===802) soundKey = 'wind-light';
    else if (code===803||code===804||code===741) soundKey = 'wind-strong';
    if (soundKey) {
        currentPlayingSound = getSound(soundKey);
        currentPlayingSound.play().catch(()=>{});
    }
}

// The video is linked to the weather + the actual time of the city
const updateBackground = (data, timezone) => {
    const mainWeather = (data.weather[0].main||"Clear").toLowerCase();
    const desc = (data.weather[0].description||"").toLowerCase();
    const isNight = data.is_day === 0 || (data.weather[0].icon||'').includes('n');

// Add a class to the body so that CSS controls the overlay
    document.body.classList.remove('is-day', 'is-night');
    document.body.classList.add(isNight ? 'is-night' : 'is-day');

    const bgVideo = document.getElementById('bg-video');
    let videoFileName = '';

    if (mainWeather==='thunderstorm'||desc.includes('thunder')||desc.includes('storm')) {
        videoFileName = 'storm_v9rxn6.mp4';
    } else if (mainWeather==='snow'||desc.includes('snow')||desc.includes('freez')||desc.includes('sleet')) {
        videoFileName = 'snow_rk8viu.mp4';
    } else if (mainWeather==='rain'||mainWeather==='drizzle'||desc.includes('rain')||desc.includes('drizzle')) {
        videoFileName = (desc.includes('heavy')||desc.includes('extreme')) ? 'rain-heavy_jca88r.mp4' : 'rain-light_h8aytl.mp4';
    } else if (mainWeather==='fog'||desc.includes('fog')||desc.includes('mist')||desc.includes('haze')) {
        videoFileName = 'clouds-light_pwnke1.mp4';
    } else if (mainWeather==='clouds'||desc.includes('cloud')||desc.includes('overcast')) {
        videoFileName = (desc.includes('few')||desc.includes('scattered')||desc.includes('light'))
            ? 'clouds-light_pwnke1.mp4' : 'clouds-heavy_v5slru.mp4';
    } else {
        // Clear: day or night based on the actual is_day from the API
        videoFileName = isNight ? 'clear-night_f8psy5.mp4' : 'clear-day_jgeqvj.mp4';
    }

    const fullVideoSrc = `${CLOUD}${videoFileName}`;
    if (_lastVideoSrc !== fullVideoSrc) {
        _lastVideoSrc = fullVideoSrc;
        bgVideo.setAttribute('src', fullVideoSrc);
        bgVideo.muted = true;
        bgVideo.load();
        bgVideo.play().catch(()=>{});
    }
};

// =========================================================
// 5. Map & Fetch Operations
// =========================================================
const getExtendedMeteoUrl = (lat, lon) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,relative_humidity_2m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum&past_days=3&forecast_days=9&timezone=auto`;

const updateMap = (lat, lon, temp, city) => {
    if (!map) {
        map = L.map('map', { scrollWheelZoom: false, touchZoom: true }).setView([lat, lon], 10);
        // Enable zooming with the mouse wheel only when the map is focused
        map.once('focus', () => map.scrollWheelZoom.enable());

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors, © CARTO'
        }).addTo(map);

        map.on('click', async (e) => {
            playClickSound();
            const { lat, lng } = e.latlng;
            if (marker) map.removeLayer(marker);
            marker = L.marker([lat, lng]).addTo(map)
                .bindPopup(`<strong style="color:#0284c7;">Loading...</strong>`, {autoPan:false}).openPopup();
            try {
                const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`);
                const geoData = await geoRes.json();
                let preciseLocation = geoData.address ? (geoData.address.city||geoData.address.town||geoData.address.village||geoData.address.state||"Unknown Area") : "Unknown Area";
                const res = await fetch(getExtendedMeteoUrl(lat, lng));
                const meteoData = await res.json();
                const isDay = meteoData.current.is_day ?? 1;
                const currentWmo = wmoToDescription(meteoData.current.weather_code, isDay);
                const currentData = {
                    name: preciseLocation,
                    coord: { lat, lon: lng },
                    main: { temp: meteoData.current.temperature_2m },
                    sys: { country: geoData.address?.country_code?.toUpperCase()||"" },
                    weather: [{ id:currentWmo.id, description:currentWmo.desc, icon:currentWmo.icon, main:currentWmo.main }],
                    is_day: isDay
                };
                updateAllUI(currentData, meteoData);
                // Log city search from map click
                try { fetch(`${BACKEND}/api/searches`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ city: preciseLocation }) }); } catch(e) {}
            } catch(err) {
                marker.bindPopup(`<strong style="color:red;">Error fetching data</strong>`, {autoPan:false}).openPopup();
            }
        });
    } else {
        map.flyTo([lat, lon], 10, { animate:true, duration:1.5 });
    }
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lon]).addTo(map)
        .bindPopup(`<strong style="color:#0284c7;">${city}</strong><br>Temp: ${Math.round(temp)}°C`, {autoPan:false}).openPopup();
};

// helper: It takes lat/lon, retrieves the data and displays it
const _fetchAndDisplay = async (lat, lon, locationName, country = "") => {
    const res = await fetch(getExtendedMeteoUrl(lat, lon));
    const meteoData = await res.json();
    const isDay = meteoData.current.is_day ?? 1;
    const currentWmo = wmoToDescription(meteoData.current.weather_code, isDay);
    const currentData = {
        name: locationName,
        coord: { lat, lon },
        main: { temp: meteoData.current.temperature_2m },
        sys: { country },
        weather: [{ id:currentWmo.id, description:currentWmo.desc, icon:currentWmo.icon, main:currentWmo.main }],
        is_day: isDay
    };
    localStorage.setItem('lastWeatherData', JSON.stringify(currentData));
    localStorage.setItem('lastMeteoData', JSON.stringify(meteoData));
    updateAllUI(currentData, meteoData);

    // Log city search to backend
    try {
        fetch(`${BACKEND}/api/searches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ city: locationName })
        });
    } catch(e) {}

    return { currentData, meteoData };
};

const fetchWeatherData = async (cityInputStr) => {
    try {
        let cleanedCity = cityInputStr.replace(/^(\u0645\u062f\u064a\u0646\u0629|\u0645\u062d\u0627\u0641\u0638\u0629|\u0648\u0644\u0627\u064a\u0629)\s/g,"").trim();

// First attempt: search by full name
        const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanedCity)}&format=json&limit=5&accept-language=en&addressdetails=1`
        );
        const geoData = await geoRes.json();

        if (geoData && geoData.length > 0) {
            const best = geoData[0];
            const lat = best.lat, lon = best.lon;
            const country = best.address?.country_code?.toUpperCase() || "";
            const name = best.address?.city || best.address?.town || best.address?.village || best.address?.state || best.name;
            document.getElementById('city-input').blur();
            await _fetchAndDisplay(lat, lon, name, country);
            return true;
        }

        // Second attempt: try the last word only
        const words = cleanedCity.split(/\s+/);
        if (words.length > 1) {
            const shortName = words[words.length - 1];
            const geoRes2 = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(shortName)}&format=json&limit=3&accept-language=en&addressdetails=1`
            );
            const geoData2 = await geoRes2.json();
            if (geoData2 && geoData2.length > 0) {
                const best = geoData2[0];
                const lat = best.lat, lon = best.lon;
                const country = best.address?.country_code?.toUpperCase() || "";
                const name = best.address?.city || best.address?.town || best.address?.village || best.address?.state || best.name;
                document.getElementById('city-input').blur();
                await _fetchAndDisplay(lat, lon, name, country);
                Swal.fire({ icon:'info', title:`Showing: ${name}`, text:`Closest match to "${cleanedCity}"`, timer:3000, showConfirmButton:false, toast:true, position:'top-end' });
                return true;
            }
        }

        throw new Error("City not found");

    } catch(error) {
        getSound('error').play().catch(()=>{});
        const lastData = JSON.parse(localStorage.getItem('lastWeatherData'));
        const lastMeteo = JSON.parse(localStorage.getItem('lastMeteoData'));
        if (lastData && lastMeteo) {
            updateAllUI(lastData, lastMeteo);
            Swal.fire({ icon:'warning', title:'Offline Mode', text:'Displaying saved data.', timer:3000, showConfirmButton:false, toast:true, position:'top-end' });
            return true;
        }
        Swal.fire({ icon:'error', title:'Not Found', text:`Couldn't find "${cityInputStr}". Try a nearby city name.` });
        return false;
    }
};


const getUserLocation = () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude, lon = position.coords.longitude;
            try {
                const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=en`);
                const geoData = await geoRes.json();
                let preciseLocation = geoData.address ? (geoData.address.city||geoData.address.town||geoData.address.state||"Current Location") : "Current Location";
                const res = await fetch(getExtendedMeteoUrl(lat, lon));
                const meteoData = await res.json();
                const isDay = meteoData.current.is_day ?? 1;
                const currentWmo = wmoToDescription(meteoData.current.weather_code, isDay);
                const currentData = {
                    name: preciseLocation,
                    coord: { lat, lon },
                    main: { temp: meteoData.current.temperature_2m },
                    sys: { country: geoData.address?.country_code?.toUpperCase()||"" },
                    weather: [{ id:currentWmo.id, description:currentWmo.desc, icon:currentWmo.icon, main:currentWmo.main }],
                    is_day: isDay
                };
                updateAllUI(currentData, meteoData);
            } catch(error) { console.error('Location error:', error); }
        }, () => {
// If the geolocation is rejected, display a simple message
            Swal.fire({ icon:'info', title:'Location Access Denied', text:'Search for a city to get weather data.', timer:3000, showConfirmButton:false });
        });
    }
};

// =========================================================
// 6. Centralized UI Rendering
// =========================================================
const updateAllUI = (currentData, meteoData) => {
    displayCurrentWeather(currentData, meteoData.timezone);
    displayCurrentConditions(meteoData);
    displayForecast(meteoData.daily);
    displayHourlyData(meteoData);
};

const displayCurrentWeather = (data, timezone) => {
    getSound('success').play().catch(()=>{});
    playWeatherSound(data);
    updateBackground(data, timezone);
    if (timezone) startLocalClock(timezone);

    const weatherSection = document.getElementById('current-weather');
    if (!weatherSection) return;
    const iconUrl = getWeatherIcon(data.weather[0].description);
    const locationDisplay = data.sys.country ? `${data.name}, ${data.sys.country}` : data.name;

    weatherSection.innerHTML = `
        <div class="current-weather-card">
            <h2>${locationDisplay}
                <button id="fav-btn"
                    title="Save to favorites"
                    style="background:transparent;border:none;color:#f59e0b;font-size:1.5rem;cursor:pointer;margin-left:10px;vertical-align:middle;">★</button>
            </h2>
            <div class="weather-info">
                <img src="${iconUrl}" alt="Weather">
                <div class="details">
                    <p class="temp">${Math.round(data.main.temp)}°C</p>
                    <p class="desc" style="text-transform:capitalize;">${data.weather[0].description}</p>
                </div>
            </div>
        </div>
    `;
    // Attach favorite button event safely (avoids quote issues in inline onclick)
    const favBtn = document.getElementById('fav-btn');
    if (favBtn) {
        favBtn.addEventListener('click', () => {
            addFavorite(data.name, data.sys.country || '', data.coord.lat, data.coord.lon);
            favBtn.textContent = '✅';
            setTimeout(() => { favBtn.textContent = '★'; }, 2000);
        });
    }
    // Attach favorite button after DOM update
    setTimeout(() => {
        const favBtn = document.getElementById('fav-btn');
        if (favBtn) {
            favBtn.onclick = () => {
                addFavorite(data.name, data.sys.country || '', data.coord.lat, data.coord.lon);
                favBtn.textContent = '✅';
                setTimeout(() => { favBtn.textContent = '★'; }, 2000);
            };
        }
    }, 50);
    updateMap(data.coord.lat, data.coord.lon, data.main.temp, data.name);
};

const displayCurrentConditions = (meteoData) => {
    const grid = document.getElementById('conditions-grid');
    if (!grid) return;
    const current = meteoData.current;
    const daily   = meteoData.daily;
    const todayIndex = 3;
    const windSpeed = current.wind_speed_10m || 0;
    const windDir   = getWindDirection(current.wind_direction_10m || 0);
    const humidity  = current.relative_humidity_2m || 0;
    const pressure  = current.surface_pressure || 0;
    const uvIndex   = daily.uv_index_max[todayIndex] || 0;
    const sunrise   = formatTime(daily.sunrise[todayIndex]);
    const sunset    = formatTime(daily.sunset[todayIndex]);

    grid.innerHTML = `
        <div class="condition-card">
            <div class="condition-title">Wind</div>
            <div class="condition-value">${windSpeed} <span class="condition-unit">km/h</span></div>
            <div class="condition-desc">Direction: ${windDir}</div>
        </div>
        <div class="condition-card">
            <div class="condition-title">Humidity</div>
            <div class="condition-value">${humidity} <span class="condition-unit">%</span></div>
            <div class="condition-desc">Dew point mapping normal</div>
        </div>
        <div class="condition-card">
            <div class="condition-title">UV Index</div>
            <div class="condition-value">${uvIndex}</div>
            <div class="condition-desc">Max exposure today</div>
        </div>
        <div class="condition-card">
            <div class="condition-title">Pressure</div>
            <div class="condition-value">${Math.round(pressure)} <span class="condition-unit">mBar</span></div>
            <div class="condition-desc">Surface Level</div>
        </div>
        <div class="condition-card sunrise-sunset-card">
            <div>
                <div class="condition-title">🌅 Sunrise</div>
                <div class="condition-value" style="justify-content:center;">${sunrise}</div>
            </div>
            <div class="local-clock-wrapper">
                <div class="condition-title">🕐 Local Time</div>
                <div id="local-clock" class="local-clock-display">--:--</div>
            </div>
            <div>
                <div class="condition-title">🌇 Sunset</div>
                <div class="condition-value" style="justify-content:center;">${sunset}</div>
            </div>
        </div>
    `;
};

// =========================================================
// Hourly Logic & Tabs
// =========================================================
const displayHourlyData = (meteoData) => {
    currentHourlyData = meteoData;
    const nowMs = Date.now();
    currentHourlyIndex = meteoData.hourly.time.findIndex(t => new Date(t).getTime() >= nowMs);
    if (currentHourlyIndex === -1) currentHourlyIndex = 72;
    renderHourlyForecastRow();
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            playClickSound();
            renderHourlyTabContent(e.target.getAttribute('data-tab'));
        });
    });
    renderHourlyTabContent('precipitation');
};

const renderHourlyForecastRow = () => {
    const container = document.getElementById('hourly-forecast-container');
    if (!container) return;
    container.innerHTML = '';
    const hourly = currentHourlyData.hourly;
    for (let i=0; i<24; i++) {
        let idx = currentHourlyIndex + i;
        if (idx >= hourly.time.length) break;
        let timeStr = new Date(hourly.time[idx]).toLocaleTimeString('en-US', {hour:'numeric', hour12:true});
        if (i===0) timeStr = 'Now';
        let temp = Math.round(hourly.temperature_2m[idx]);
        let hour = parseInt(hourly.time[idx].split('T')[1]);
        let isDayHourly = hour>=6 && hour<20 ? 1 : 0;
        let wmoDesc = wmoToDescription(hourly.weather_code[idx], isDayHourly).desc;
        let icon = getWeatherIcon(wmoDesc);
        container.innerHTML += `
            <div class="hourly-item">
                <span class="temp">${temp}°</span>
                <img src="${icon}" alt="icon">
                <span class="time">${timeStr}</span>
            </div>
        `;
    }
};

const renderHourlyTabContent = (tabType) => {
    const contentDiv = document.getElementById('hourly-tab-content');
    if (!contentDiv||!currentHourlyData) return;
    const hourly = currentHourlyData.hourly;
    const daily  = currentHourlyData.daily;
    const todayIndex = 3;
    let totalText="", valuesArray=[], unit="", fillMax=100;

    if (tabType==='precipitation') {
        const totalAmount = daily.precipitation_sum[todayIndex]||0;
        totalText = `<div style="font-size:0.9rem;color:var(--text-dim);">Today's amount</div><div class="tab-amount">${totalAmount} <span style="font-size:1.2rem;font-weight:400;">mm</span></div>`;
        valuesArray = hourly.precipitation_probability; unit="%";
    } else if (tabType==='wind') {
        const currentWind = hourly.wind_speed_10m[currentHourlyIndex]||0;
        totalText = `<div style="font-size:0.9rem;color:var(--text-dim);">Current speed</div><div class="tab-amount">${currentWind} <span style="font-size:1.2rem;font-weight:400;">km/h</span></div>`;
        valuesArray = hourly.wind_speed_10m; unit=" km/h"; fillMax=50;
    } else if (tabType==='humidity') {
        const currentHum = hourly.relative_humidity_2m[currentHourlyIndex]||0;
        totalText = `<div style="font-size:0.9rem;color:var(--text-dim);">Current humidity</div><div class="tab-amount">${currentHum} <span style="font-size:1.2rem;font-weight:400;">%</span></div>`;
        valuesArray = hourly.relative_humidity_2m; unit="%";
    } else if (tabType==='sunshine') {
        const uvMax = daily.uv_index_max[todayIndex]||0;
        totalText = `<div style="font-size:0.9rem;color:var(--text-dim);">Max UV Index Today</div><div class="tab-amount">${uvMax}</div>`;
        valuesArray = hourly.uv_index; unit=" UV"; fillMax=11;
    }

    let rowsHtml = `<div class="tab-row-container" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:20px;overflow-x:auto;padding-bottom:15px;width:100%;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;">`;
    const startIdx = Math.max(0, currentHourlyIndex-24);
    const endIdx   = Math.min(hourly.time.length, currentHourlyIndex+24);
    for (let idx=startIdx; idx<endIdx; idx++) {
        let isNow = (idx===currentHourlyIndex);
        let timeStr = new Date(hourly.time[idx]).toLocaleTimeString('en-US', {hour:'numeric', hour12:true});
        if (isNow) timeStr='Now';
        let val = Math.round(valuesArray[idx]||0);
        let percent = Math.min((val/fillMax)*100, 100);
        let activeColor  = isNow ? 'var(--text-main)' : 'var(--text-dim)';
        let activeWeight = isNow ? 'bold' : 'normal';
        rowsHtml += `
            <div class="tab-row-item" id="${isNow?'tab-now-item':''}" style="display:flex;flex-direction:column;align-items:center;min-width:60px;flex:0 0 auto;scroll-snap-align:center;gap:8px;">
                <div class="tab-pill" style="width:40px;height:10px;border-radius:5px;background:rgba(255,255,255,0.1);overflow:hidden;position:relative;border:1px solid var(--glass-border);">
                    <div class="tab-pill-fill" style="height:100%;background:var(--accent-color);position:absolute;bottom:0;left:0;border-radius:5px;width:${percent}%;"></div>
                </div>
                <span class="tab-val" style="color:${activeColor};font-weight:600;font-size:0.95rem;">${val}${unit}</span>
                <span class="tab-time" style="color:${activeColor};font-weight:${activeWeight};font-size:0.85rem;">${timeStr}</span>
            </div>
        `;
    }
    rowsHtml += `</div>`;
    contentDiv.innerHTML = totalText + rowsHtml;
    setTimeout(() => {
        const nowTab = document.getElementById('tab-now-item');
        const cont   = contentDiv.querySelector('.tab-row-container');
        if (nowTab && cont) {
            cont.scrollTo({ left: nowTab.offsetLeft - cont.clientWidth/2 + nowTab.clientWidth/2, behavior:'smooth' });
        }
    }, 150);
};

const displayForecast = (daily) => {
    const forecastContainer = document.getElementById('forecast-cards');
    const forecastSection   = document.querySelector('.forecast-section');
    if (!forecastContainer) return;
    forecastContainer.innerHTML = '';
    const today = new Date().toISOString().split('T')[0];
    const todayIdx = daily.time.findIndex(d => d === today);
    // Show 3 days before today + today + 9 days after
    const startIdx = Math.max(0, todayIdx - 3);
    const endIdx   = Math.min(daily.time.length, todayIdx + 10);
    const allData = daily.time.map((dateStr, index) => ({
        dateStr,
        temp_max: daily.temperature_2m_max[index],
        temp_min: daily.temperature_2m_min[index],
        weather: [{ description: wmoToDescription(daily.weather_code[index]).desc }]
    }));
    const dailyData = allData.slice(startIdx, endIdx);
    dailyData.forEach(day => {
        const isToday = new Date().toISOString().split('T')[0] === day.dateStr;
        const dateLabel = isToday ? "Today" : new Date(day.dateStr).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
        const iconUrl = getWeatherIcon(day.weather[0].description);
        const card = document.createElement('div');
        card.className = 'weather-card';
        if (isToday) card.style.border = "2px solid var(--accent-color)";
        card.innerHTML = `
            <h4>${dateLabel}</h4>
            <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin:15px 0;">
                <img src="${iconUrl}" style="width:50px;height:auto;">
                <span style="font-size:0.9rem;text-transform:capitalize;color:var(--text-dim);text-align:left;">${day.weather[0].description}</span>
            </div>
            <p><strong>${Math.round(day.temp_max)}°</strong> / ${Math.round(day.temp_min)}°</p>
        `;
        forecastContainer.appendChild(card);
    });
    renderForecastTable(dailyData, forecastSection||forecastContainer.parentElement);
    renderChart(dailyData);
};

const renderForecastTable = (dailyData, container) => {
    if (!container) return;
    let oldWrapper = container.querySelector('.table-responsive-wrapper');
    if (oldWrapper) oldWrapper.remove();
    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive-wrapper';
    const table = document.createElement('table');
    table.className = 'forecast-table';
    table.innerHTML = `
        <thead><tr><th>Day</th><th>Date</th><th>Icon</th><th>Condition</th><th>High</th><th>Low</th></tr></thead>
        <tbody>
            ${dailyData.map(day => {
                const isToday = new Date().toISOString().split('T')[0] === day.dateStr;
                const dayName = isToday ? "Today" : new Date(day.dateStr).toLocaleDateString('en-US', {weekday:'long'});
                return `<tr>
                    <td style="font-weight:bold;color:var(--accent-color);">${dayName}</td>
                    <td>${new Date(day.dateStr).toLocaleDateString('en-US')}</td>
                    <td><img src="${getWeatherIcon(day.weather[0].description)}" style="width:40px;"></td>
                    <td style="text-transform:capitalize;">${day.weather[0].description}</td>
                    <td>${Math.round(day.temp_max)}°C</td>
                    <td>${Math.round(day.temp_min)}°C</td>
                </tr>`;
            }).join('')}
        </tbody>
    `;
    wrapper.appendChild(table);
    container.insertBefore(wrapper, container.querySelector('.chart-container'));
};

const renderChart = (dailyData) => {
    const ctx = document.getElementById('forecast-chart').getContext('2d');
    if (forecastChartInstance) forecastChartInstance.destroy();
    const isLight   = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#64748b' : '#94a3b8';
    forecastChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dailyData.map(d => new Date(d.dateStr).toLocaleDateString('en-US', {weekday:'short'})),
            datasets: [
                { label:'Max Temp (°C)', data:dailyData.map(d=>Math.round(d.temp_max)), borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,0.2)', borderWidth:3, tension:0.4, fill:true },
                { label:'Min Temp (°C)', data:dailyData.map(d=>Math.round(d.temp_min)), borderColor:'#94a3b8', borderWidth:2, borderDash:[5,5], tension:0.4 }
            ]
        },
        options: {
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{ labels:{ color:textColor } } },
            scales:{ y:{ ticks:{ color:textColor } }, x:{ ticks:{ color:textColor } } }
        }
    });
};

// =========================================================
// 7. Events & Event Listeners
// =========================================================
document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    playClickSound();
    const cityInput = document.getElementById('city-input');
    if (cityInput.value.trim()) {
        await fetchWeatherData(cityInput.value.trim());
        cityInput.value = '';
    }
});

const themeToggle = document.getElementById('theme-toggle');
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    themeToggle.innerHTML = '🌙 Dark Mode';
}

themeToggle.addEventListener('click', () => {
    playClickSound();
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    themeToggle.innerHTML = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';
// Redraw chart with correct theme colors
    const lastData = JSON.parse(localStorage.getItem('lastMeteoData'));
    if (lastData) renderChart(lastData.daily.time.map((dateStr,i)=>({
        dateStr,
        temp_max: lastData.daily.temperature_2m_max[i],
        temp_min: lastData.daily.temperature_2m_min[i],
        weather:[{description: wmoToDescription(lastData.daily.weather_code[i]).desc}]
    })));
});

let isAudioUnlocked = false;
document.addEventListener('click', () => {
    if (!isAudioUnlocked) {
        isAudioUnlocked = true;
        if (currentPlayingSound && currentPlayingSound.paused) currentPlayingSound.play().catch(()=>{});
    }
}, { once:true });

const voiceBtn = document.getElementById('voice-search-btn');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart  = () => voiceBtn.classList.add('listening');
    recognition.onresult = (e) => {
        document.getElementById('city-input').value = e.results[0][0].transcript;
        playClickSound();
        document.getElementById('search-form').dispatchEvent(new Event('submit'));
    };
    recognition.onerror = () => voiceBtn.classList.remove('listening');
    recognition.onend   = () => voiceBtn.classList.remove('listening');
    voiceBtn.addEventListener('click', () => { playClickSound(); recognition.start(); });
} else {
    voiceBtn.style.display = 'none';
}

window.onload = () => {
    getUserLocation();
    registerVisit();
    renderFavorites();
};
