import express from 'express';
import fetch from 'node-fetch';
import ical from 'node-ical';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Add this near the top of your server.js file
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} (BASE_PATH=${BASE_PATH})`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});


// The BASE_PATH is only used for frontend URLs, not for route definitions
const BASE_PATH = process.env.BASE_PATH || '/fc';


// Add this near the top of your server.js file
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} (BASE_PATH=${BASE_PATH})`);
  next();
});



console.log('Using BASE_PATH:', BASE_PATH);

const ICS_URLS = (process.env.ICS_URLS || '').split(',').map(u => u.trim()).filter(Boolean);

if (!ICS_URLS.length) {
  console.error('Error: No ICS URLs provided. Set the ICS_URLS environment variable.');
  process.exit(1);
}

const CACHE_TTL_MS = 5 * 60 * 1000;

function generateColor(index, total = 12, lightness = 70, saturation = 70, alpha = 0.4) {
  const hue = (index * 360 / total) % 360;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

// Serve static files from 'public' directory at the root path
app.use(express.static(path.join(__dirname, 'public')));

// IMPORTANT: Also serve static files at the BASE_PATH
// This ensures files are available at both /fullcalendar/main.min.js and /fc/fullcalendar/main.min.js
if (BASE_PATH && BASE_PATH !== '/') {
  app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));
}

// Global cache
let cachedEvents = [];
let feedMeta = {};
let lastFetch = 0;

async function fetchAllEvents() {
  console.log('Fetching events from ICS URLs:', ICS_URLS);
  const events = [];
  const meta = {};

  for (const [i, url] of ICS_URLS.entries()) {
    const sourceId = `feed-${i + 1}`;
    const color = generateColor(i, ICS_URLS.length);
    let calendarName = `Feed ${i + 1}`;

    try {
      console.log(`Fetching ICS from: ${url}`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();

      const calNameMatch = text.match(/X-WR-CALNAME:(.+)/i);
      if (calNameMatch) calendarName = calNameMatch[1].trim();

      meta[sourceId] = { name: calendarName, color };

      const data = ical.parseICS(text);
      let feedEventCount = 0;
      for (const k in data) {
        const ev = data[k];
        if (ev.type === 'VEVENT') {
          events.push({
            title: ev.summary,
            start: ev.start,
            end: ev.end,
            allDay: ev.datetype === 'date',
            source: sourceId,
            sourceName: calendarName
          });
          feedEventCount++;
        }
      }
      console.log(`Processed ${url}: found ${feedEventCount} events`);
    } catch (err) {
      console.error(`Failed to process ICS feed (${url}): ${err.message}`);
    }
  }

  console.log(`Total events fetched: ${events.length}`);
  return { events, feedMeta: meta };
}

// Debug endpoint to check environment variables
app.get('/debug', (_req, res) => {
  res.json({
    BASE_PATH,
    ICS_URLS,
    env: process.env
  });
});

// Also modify the main route to log more information
app.get('/', (_req, res) => {
  console.log(`Rendering index with BASE_PATH=${BASE_PATH}`);
  console.log('Full URL path:', _req.originalUrl);
  console.log('Host:', _req.headers.host);
  console.log('X-Forwarded-Host:', _req.headers['x-forwarded-host']);
  console.log('X-Forwarded-Proto:', _req.headers['x-forwarded-proto']);
  console.log('X-Forwarded-For:', _req.headers['x-forwarded-for']);
  
  res.render('index', { 
    BASE_PATH, 
    title: 'Football Calendar'
  });
});

// API endpoint for events
app.get('/events', async (_req, res) => {
  console.log('Handling /events request');
  const now = Date.now();

  try {
    if (now - lastFetch > CACHE_TTL_MS || cachedEvents.length === 0) {
      console.log('Cache expired or empty, fetching fresh events');
      const result = await fetchAllEvents();
      cachedEvents = result.events;
      feedMeta = result.feedMeta;
      lastFetch = now;
      console.log(`Fetched ${cachedEvents.length} events from ${Object.keys(feedMeta).length} feeds`);
    } else {
      console.log(`Using cached events (${cachedEvents.length} events)`);
    }

    res.json({ events: cachedEvents, feeds: feedMeta });
  } catch (err) {
    console.error('Unexpected error in /events:', err);
    res.status(500).json({ error: `Server error fetching calendar data: ${err.message}` });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Listening on http://0.0.0.0:${PORT}`);
  console.log(`BASE_PATH: ${BASE_PATH}`);
  console.log(`ICS_URLS: ${ICS_URLS.length} URLs configured`);
});
