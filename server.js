const express = require('express');
const path = require('path');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID KEYS ────────────────────────────────────────────────────────
// On first deploy, keys are generated and logged to Railway console.
// Copy them into Railway env vars (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
// so they stay consistent across restarts.
let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  console.log('=== VAPID KEYS GENERATED — add these to Railway env vars ===');
  console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
  console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
  console.log('=============================================================');
}

webpush.setVapidDetails(
  'mailto:carveralex24@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ── STATE (in-memory, single user) ───────────────────────────────────
let pushSubscription = null;
let tasksDoneDate = null; // 'YYYY-MM-DD' when all tasks completed

// ── HELPERS ───────────────────────────────────────────────────────────
function getTodayUK() {
  const d = new Date();
  const uk = new Date(d.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const y = uk.getFullYear();
  const m = String(uk.getMonth() + 1).padStart(2, '0');
  const day = String(uk.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDayOfWeekUK() {
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const d = new Date();
  const uk = new Date(d.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  return uk.getDay();
}

async function sendPush(payload) {
  if (!pushSubscription) return;
  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    console.log('Push sent:', payload.title);
  } catch (err) {
    console.error('Push failed:', err.statusCode, err.message);
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired/invalid — clear it
      pushSubscription = null;
    }
  }
}

// ── API ROUTES ────────────────────────────────────────────────────────
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  pushSubscription = req.body;
  console.log('Push subscription saved');
  res.json({ ok: true });
});

app.post('/api/tasks-complete', (req, res) => {
  tasksDoneDate = req.body.date;
  console.log('Tasks marked complete for', tasksDoneDate);
  res.json({ ok: true });
});

app.post('/api/tasks-reset', (req, res) => {
  tasksDoneDate = null;
  res.json({ ok: true });
});

app.post('/api/test-notification', async (req, res) => {
  try {
    await sendPush({
      title: 'Test notification 💜',
      body: "It's working Alex — push notifications are live!",
      tag: 'test',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SCHEDULED NOTIFICATIONS (UK time) ────────────────────────────────

// 9:00 AM — morning nudge every day
cron.schedule('0 9 * * *', () => {
  sendPush({
    title: 'Good morning Alex 💪',
    body: "Time to get after it — open your tracker to see today's tasks.",
    tag: 'morning',
  });
}, { timezone: 'Europe/London' });

// 6:00 PM — evening reminders if tasks not done
cron.schedule('0 18 * * *', () => {
  const today = getTodayUK();
  const day = getDayOfWeekUK();

  if (tasksDoneDate === today) {
    console.log('All tasks done today — skipping 6pm reminder');
    return;
  }

  // Main task reminder
  sendPush({
    title: "Tasks still pending 💜",
    body: "Hey Alex, you still have tasks to complete today — don't break the streak! 💜",
    tag: 'evening',
  });

  // Day-specific scheduling reminder (2s later so they arrive as separate notifications)
  setTimeout(() => {
    if (day === 0 || day === 4) {
      // Sunday or Thursday
      sendPush({
        title: "Follow up emails 📧",
        body: "Don't forget to schedule your follow up emails for tomorrow Alex!",
        tag: 'scheduling',
      });
    } else if (day === 1 || day === 2 || day === 3) {
      // Monday, Tuesday, Wednesday
      sendPush({
        title: "Cold emails 📧",
        body: "Don't forget to schedule your cold emails for tomorrow Alex!",
        tag: 'scheduling',
      });
    }
  }, 2000);

}, { timezone: 'Europe/London' });

// ── ICON (generated purple square with checkmark) ─────────────────────
function iconSvg(size) {
  const r = Math.round(size * 0.18);
  const fontSize = Math.round(size * 0.42);
  const y = Math.round(size * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#080810"/>
  <text x="${size/2}" y="${y}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
    font-size="${fontSize}" font-weight="900" fill="#7c3aed">adt</text>
</svg>`;
}

app.get('/icon-192.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(iconSvg(192));
});

app.get('/icon-512.png', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(iconSvg(512));
});

// ── CATCH-ALL ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Daily tracker running on port ${PORT}`);
});
