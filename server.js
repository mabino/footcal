import express from 'express';
import fetch from 'node-fetch';
import ical from 'node-ical';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const ICS_URLS = (process.env.ICS_URLS || '').split(',').map(u => u.trim());
const CACHE_TTL_MS = 5 * 60 * 1000;

function generateColor(index, total = 12, lightness = 70, saturation = 70, alpha = 0.4) {
  const hue = (index * 360 / total) % 360;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// Global cache
let cachedEvents = [];
let feedMeta = {};
let lastFetch = 0;

async function fetchAllEvents() {
  const events = [];
  const meta = {};

  for (const [i, url] of ICS_URLS.entries()) {
    const sourceId = `feed-${i + 1}`;
    const color = generateColor(i, ICS_URLS.length);
    let calendarName = `Feed ${i + 1}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();

      // Extract calendar name from X-WR-CALNAME
      const calNameMatch = text.match(/X-WR-CALNAME:(.+)/i);
      if (calNameMatch) calendarName = calNameMatch[1].trim();

      meta[sourceId] = { name: calendarName, color };

      const data = ical.parseICS(text);
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
        }
      }
    } catch (err) {
      console.error(`Failed to process ICS feed (${url}): ${err.message}`);
    }
  }

  return { events, feedMeta: meta };
}

app.get('/events', async (_req, res) => {
  const now = Date.now();

  try {
    if (now - lastFetch > CACHE_TTL_MS) {
      const result = await fetchAllEvents();
      cachedEvents = result.events;
      feedMeta = result.feedMeta;
      lastFetch = now;
    }

    res.json({ events: cachedEvents, feeds: feedMeta });
  } catch (err) {
    console.error('Unexpected error in /events:', err);
    res.status(500).json({ error: 'Server error fetching calendar data.' });
  }
});

app.listen(8080, () => console.log('Listening on http://0.0.0.0:8080'));
