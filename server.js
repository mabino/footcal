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

// The BASE_PATH is only used for frontend URLs, not for route definitions
const BASE_PATH = process.env.BASE_PATH || '/fc';
console.log('Using BASE_PATH:', BASE_PATH);

const ICS_URLS = (process.env.ICS_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
console.log('ICS_URLS:', ICS_URLS.length, 'URLs configured');

if (!ICS_URLS.length) {
  console.error('Error: No ICS URLs provided. Set the ICS_URLS environment variable.');
  process.exit(1);
}

const CACHE_TTL_MS = 5 * 60 * 1000;

function generateColor(index, total = 12, lightness = 70, saturation = 70, alpha = 0.4) {
  const hue = (index * 360 / total) % 360;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

// Serve static files from the 'public' directory
// IMPORTANT: Mount this at the BASE_PATH to ensure correct URL paths
app.use(`${BASE_PATH}/fullcalendar`, express.static(path.join(__dirname, 'node_modules', '@fullcalendar', 'core', 'main')));

// Debug middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} (BASE_PATH=${BASE_PATH})`);
  next();
});

// Main route - IMPORTANT: Mount this at the BASE_PATH
app.get(BASE_PATH, (req, res) => {
  console.log(`Rendering index with BASE_PATH=${BASE_PATH}`);
  res.render('index', { 
    BASE_PATH, 
    title: 'Football Calendar'
  });
});

// Also handle the root path and redirect to the BASE_PATH
app.get('/', (req, res) => {
  console.log(`Redirecting from / to ${BASE_PATH}`);
  res.redirect(BASE_PATH);
});

// Events API - IMPORTANT: Mount this at the BASE_PATH
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
        
        // Extract feed name from URL
        const urlObj = new URL(url);
        const feedId = `feed${index}`;
        const feedName = urlObj.hostname;
        
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on http://0.0.0.0:${PORT}`);
  console.log(`BASE_PATH: ${BASE_PATH}`);
});
