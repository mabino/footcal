import express from 'express';
import fetch from 'node-fetch';
import ical from 'node-ical';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// The BASE_PATH is only used for frontend URLs, not for route definitions
const BASE_PATH = process.env.BASE_PATH || '/fc';
console.log('Using BASE_PATH:', BASE_PATH);

const ICS_URLS = (process.env.ICS_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
console.log('ICS_URLS:', ICS_URLS.length, 'URLs configured');

if (!ICS_URLS.length) {
  console.error('Error: No ICS URLs provided. Set the ICS_URLS environment variable.');
  process.exit(1);
}

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl} (BASE_PATH=${BASE_PATH})`);
  next();
});

// IMPORTANT: Correctly serve FullCalendar files
// The path is directly in the fullcalendar directory (not in a dist subdirectory)
app.use(`${BASE_PATH}/fullcalendar`, express.static(path.join(__dirname, 'node_modules', 'fullcalendar')));

// Handle both root path and BASE_PATH
app.get(['/', BASE_PATH, `${BASE_PATH}/`], (req, res) => {
  console.log(`Rendering index for path: ${req.path}`);
  res.render('index', { 
    BASE_PATH, 
    title: 'Football Calendar'
  });
});

// Events API
app.get(`${BASE_PATH}/events`, async (req, res) => {
  console.log('Fetching events...');
  try {
    const feeds = {};
    const events = [];

    await Promise.all(ICS_URLS.map(async (url, index) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text();
        const data = ical.parseICS(text);

        // Extract X-WR-CALNAME from ICS text
        let calName = null;
        const calNameMatch = text.match(/^X-WR-CALNAME:(.+)$/m);
        if (calNameMatch) {
          calName = calNameMatch[1].trim();
        }

        // Fallback to hostname if no X-WR-CALNAME
        const urlObj = new URL(url);
        const feedId = `feed${index}`;
        const feedName = calName || urlObj.hostname;

        feeds[feedId] = {
          name: feedName,
          color: generateColor(index)
        };

        // Process events
        for (const k in data) {
          if (data[k].type !== 'VEVENT') continue;

          const event = data[k];
          events.push({
            id: `${feedId}-${k}`,
            title: event.summary,
            start: event.start,
            end: event.end,
            source: feedId,
            description: event.description,
            location: event.location
          });
        }
      } catch (error) {
        console.error(`Error fetching or parsing feed ${url}:`, error);
      }
    }));

    res.json({ events, feeds });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

function generateColor(index, total = 12, lightness = 70, saturation = 70, alpha = 0.4) {
  const hue = (index * 360 / total) % 360;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on http://0.0.0.0:${PORT}`);
  console.log(`BASE_PATH: ${BASE_PATH}`);
});
